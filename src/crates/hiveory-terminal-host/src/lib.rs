//! Durable local terminal host.
//!
//! Hiveory's Tauri process owns the window and renderer, but it must not own
//! the lifetime of a shell or coding-agent PTY.  This crate provides the
//! small authenticated loopback protocol used by a hidden sibling process.
//! The host stays alive when the window closes, and the next Hiveory process
//! reconnects to the same PTYs by their persisted resource ids.

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine};
use hiveory_code_runtime::{HiveoryCodeRuntime, HiveoryCodeRuntimeError, TerminalEventSink};
use hiveory_persistence::{code::CodeTerminalHistoryRecord, HiveoryPersistence};
use hiveory_platform_process::configure_background_command;
use hiveory_protocol::{
    CodeTerminalEvent, CodeTerminalEventKind, CodeTerminalInputRequest, CodeTerminalResizeRequest,
    CodeTerminalSnapshot, CodeTerminalSnapshotQuery, CodeTerminalStartRequest,
    CodeTerminalStopRequest, CodeTerminalSubscribeRequest, CodeTerminalSummary,
};
use hiveory_secret_store::{HiveoryKeyringSecretStore, HiveorySecretStore};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::Write as StdWrite,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    time::{sleep, timeout},
};

const READY_FILE_VERSION: u16 = 1;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Error, Clone)]
pub enum HiveoryTerminalHostError {
    #[error("terminal dimensions are invalid")]
    InvalidDimensions,
    #[error("coding-agent adapter is not supported")]
    UnsupportedAdapter,
    #[error("coding-agent process was cancelled")]
    Cancelled,
    #[error("terminal was not found")]
    TerminalNotFound,
    #[error("terminal host operation failed: {0}")]
    Operation(String),
}

impl From<HiveoryCodeRuntimeError> for HiveoryTerminalHostError {
    fn from(error: HiveoryCodeRuntimeError) -> Self {
        match error {
            HiveoryCodeRuntimeError::InvalidDimensions => Self::InvalidDimensions,
            HiveoryCodeRuntimeError::UnsupportedAdapter => Self::UnsupportedAdapter,
            HiveoryCodeRuntimeError::Cancelled => Self::Cancelled,
            HiveoryCodeRuntimeError::TerminalNotFound => Self::TerminalNotFound,
            HiveoryCodeRuntimeError::Operation(message) => Self::Operation(message),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReadyFile {
    version: u16,
    port: u16,
    token: String,
    pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload")]
enum HostRequest {
    Health,
    Start {
        request: CodeTerminalStartRequest,
        workspace_root: String,
        terminal_id: Option<String>,
        history_enabled: Option<bool>,
    },
    List,
    Snapshot(CodeTerminalSnapshotQuery),
    Subscribe(CodeTerminalSubscribeRequest),
    Write(CodeTerminalInputRequest),
    Resize(CodeTerminalResizeRequest),
    Stop(CodeTerminalStopRequest),
    SetHistoryEnabled {
        terminal_id: String,
        enabled: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WireRequest {
    token: String,
    request: HostRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload")]
enum HostResponse {
    Health,
    Summary(CodeTerminalSummary),
    Summaries(Vec<CodeTerminalSummary>),
    Snapshot(CodeTerminalSnapshot),
    Bool(bool),
    SubscribeReady,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HostErrorPayload {
    code: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WireResponse {
    ok: bool,
    response: Option<HostResponse>,
    error: Option<HostErrorPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WireEvent {
    event: CodeTerminalEvent,
}

#[derive(Debug, Clone)]
struct Endpoint {
    port: u16,
    token: String,
}

#[derive(Clone)]
pub struct HiveoryTerminalHostClient {
    inner: Arc<ClientInner>,
}

struct ClientInner {
    database_path: PathBuf,
    history_key_ref: String,
    executable: PathBuf,
    ready_file: PathBuf,
    lock_file: PathBuf,
    endpoint: tokio::sync::Mutex<Endpoint>,
}

pub struct HiveoryTerminalHostEventReceiver {
    reader: BufReader<tokio::net::tcp::OwnedReadHalf>,
}

impl HiveoryTerminalHostEventReceiver {
    pub async fn recv(&mut self) -> Result<CodeTerminalEvent, HiveoryTerminalHostError> {
        let mut line = String::new();
        let bytes = self
            .reader
            .read_line(&mut line)
            .await
            .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?;
        if bytes == 0 {
            return Err(HiveoryTerminalHostError::Operation(
                "terminal host event stream closed".to_owned(),
            ));
        }
        serde_json::from_str::<WireEvent>(&line)
            .map(|wire| wire.event)
            .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))
    }
}

impl HiveoryTerminalHostClient {
    pub async fn connect_or_start(
        database_path: PathBuf,
        history_key_ref: String,
    ) -> Result<Self, HiveoryTerminalHostError> {
        let app_data_dir = database_path.parent().ok_or_else(|| {
            HiveoryTerminalHostError::Operation("database path has no parent".to_owned())
        })?;
        let executable = std::env::current_exe()
            .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?;
        let ready_file = app_data_dir.join("terminal-host.json");
        let lock_file = app_data_dir.join("terminal-host.lock");
        let endpoint = discover_or_start(
            &database_path,
            &history_key_ref,
            &executable,
            &ready_file,
            &lock_file,
        )
        .await?;
        Ok(Self {
            inner: Arc::new(ClientInner {
                database_path,
                history_key_ref,
                executable,
                ready_file,
                lock_file,
                endpoint: tokio::sync::Mutex::new(endpoint),
            }),
        })
    }

    pub async fn start(
        &self,
        request: &CodeTerminalStartRequest,
        workspace_root: &Path,
        terminal_id: Option<String>,
        history_enabled: Option<bool>,
    ) -> Result<CodeTerminalSummary, HiveoryTerminalHostError> {
        match self
            .request(HostRequest::Start {
                request: request.clone(),
                workspace_root: workspace_root.to_string_lossy().into_owned(),
                terminal_id,
                history_enabled,
            })
            .await?
        {
            HostResponse::Summary(summary) => Ok(summary),
            other => Err(unexpected_response(other)),
        }
    }

    pub async fn list(&self) -> Result<Vec<CodeTerminalSummary>, HiveoryTerminalHostError> {
        match self.request(HostRequest::List).await? {
            HostResponse::Summaries(summaries) => Ok(summaries),
            other => Err(unexpected_response(other)),
        }
    }

    pub async fn snapshot(
        &self,
        query: &CodeTerminalSnapshotQuery,
    ) -> Result<CodeTerminalSnapshot, HiveoryTerminalHostError> {
        match self.request(HostRequest::Snapshot(query.clone())).await? {
            HostResponse::Snapshot(snapshot) => Ok(snapshot),
            other => Err(unexpected_response(other)),
        }
    }

    pub async fn subscribe(
        &self,
        request: &CodeTerminalSubscribeRequest,
    ) -> Result<HiveoryTerminalHostEventReceiver, HiveoryTerminalHostError> {
        let endpoint = self.endpoint().await;
        match self.open_subscription(&endpoint, request).await {
            Ok(receiver) => Ok(receiver),
            Err(error) if is_transport_error(&error) => {
                let endpoint = self.refresh_endpoint().await?;
                self.open_subscription(&endpoint, request).await
            }
            Err(error) => Err(error),
        }
    }

    pub async fn write(
        &self,
        request: &CodeTerminalInputRequest,
    ) -> Result<(), HiveoryTerminalHostError> {
        match self.request(HostRequest::Write(request.clone())).await? {
            HostResponse::Bool(true) => Ok(()),
            HostResponse::Bool(false) => Err(HiveoryTerminalHostError::TerminalNotFound),
            other => Err(unexpected_response(other)),
        }
    }

    pub async fn resize(
        &self,
        request: &CodeTerminalResizeRequest,
    ) -> Result<bool, HiveoryTerminalHostError> {
        match self.request(HostRequest::Resize(request.clone())).await? {
            HostResponse::Bool(value) => Ok(value),
            other => Err(unexpected_response(other)),
        }
    }

    pub async fn stop(
        &self,
        request: &CodeTerminalStopRequest,
    ) -> Result<bool, HiveoryTerminalHostError> {
        match self.request(HostRequest::Stop(request.clone())).await? {
            HostResponse::Bool(value) => Ok(value),
            other => Err(unexpected_response(other)),
        }
    }

    pub async fn set_history_enabled(
        &self,
        terminal_id: &str,
        enabled: bool,
    ) -> Result<bool, HiveoryTerminalHostError> {
        match self
            .request(HostRequest::SetHistoryEnabled {
                terminal_id: terminal_id.to_owned(),
                enabled,
            })
            .await?
        {
            HostResponse::Bool(value) => Ok(value),
            other => Err(unexpected_response(other)),
        }
    }

    async fn request(
        &self,
        request: HostRequest,
    ) -> Result<HostResponse, HiveoryTerminalHostError> {
        let endpoint = self.endpoint().await;
        match send_request(&endpoint, request.clone()).await {
            Ok(response) => Ok(response),
            Err(error) if is_transport_error(&error) => {
                let endpoint = self.refresh_endpoint().await?;
                send_request(&endpoint, request).await
            }
            Err(error) => Err(error),
        }
    }

    async fn open_subscription(
        &self,
        endpoint: &Endpoint,
        request: &CodeTerminalSubscribeRequest,
    ) -> Result<HiveoryTerminalHostEventReceiver, HiveoryTerminalHostError> {
        let mut stream = connect(endpoint).await?;
        let wire = WireRequest {
            token: endpoint.token.clone(),
            request: HostRequest::Subscribe(request.clone()),
        };
        write_json(&mut stream, &wire).await?;
        let (reader, _) = stream.into_split();
        let mut reader = BufReader::new(reader);
        let response = read_json::<WireResponse, _>(&mut reader).await?;
        if !response.ok {
            return Err(host_error(response.error));
        }
        if !matches!(response.response, Some(HostResponse::SubscribeReady)) {
            return Err(HiveoryTerminalHostError::Operation(
                "terminal host rejected the event subscription".to_owned(),
            ));
        }
        Ok(HiveoryTerminalHostEventReceiver { reader })
    }

    async fn endpoint(&self) -> Endpoint {
        self.inner.endpoint.lock().await.clone()
    }

    async fn refresh_endpoint(&self) -> Result<Endpoint, HiveoryTerminalHostError> {
        let mut guard = self.inner.endpoint.lock().await;
        if health_check(&guard).await.is_ok() {
            return Ok(guard.clone());
        }
        let endpoint = discover_or_start(
            &self.inner.database_path,
            &self.inner.history_key_ref,
            &self.inner.executable,
            &self.inner.ready_file,
            &self.inner.lock_file,
        )
        .await?;
        *guard = endpoint.clone();
        Ok(endpoint)
    }
}

async fn discover_or_start(
    database_path: &Path,
    history_key_ref: &str,
    executable: &Path,
    ready_file: &Path,
    lock_file: &Path,
) -> Result<Endpoint, HiveoryTerminalHostError> {
    if let Some(endpoint) = read_ready(ready_file) {
        if health_check(&endpoint).await.is_ok() {
            return Ok(endpoint);
        }
    }

    // A host writes its lock before its ready file. If another Hiveory
    // process is already bringing that host up, wait for it instead of
    // spawning a competing host with a different authentication token.
    if lock_file.exists() {
        if lock_is_owned_by_live_host(lock_file, executable) {
            if let Some(endpoint) = wait_for_healthy_ready(ready_file, STARTUP_TIMEOUT).await {
                return Ok(endpoint);
            }
            return Err(HiveoryTerminalHostError::Operation(
                "terminal host is still starting".to_owned(),
            ));
        }
        // The lock belongs to a host that is no longer alive. Its PTYs are
        // already gone, so only the coordination files need to be removed;
        // the next host will restore the durable transcript.
        let _ = std::fs::remove_file(ready_file);
        let _ = std::fs::remove_file(lock_file);
    }

    let token = format!("host-{}", uuid::Uuid::now_v7());
    let mut command = Command::new(executable);
    configure_background_command(&mut command);
    command
        .arg("--terminal-host")
        .arg("--database")
        .arg(database_path)
        .arg("--ready-file")
        .arg(ready_file)
        .arg("--lock-file")
        .arg(lock_file)
        .arg("--history-key-ref")
        .arg(history_key_ref)
        .arg("--host-token")
        .arg(&token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match command.spawn() {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            // Another launcher won the race between the lock check and the
            // child spawn. Reuse its healthy endpoint.
            if let Some(endpoint) = wait_for_healthy_ready(ready_file, STARTUP_TIMEOUT).await {
                return Ok(endpoint);
            }
            return Err(HiveoryTerminalHostError::Operation(
                "terminal host lock is owned but no healthy host became ready".to_owned(),
            ));
        }
        Err(error) => {
            return Err(HiveoryTerminalHostError::Operation(format!(
                "terminal host start failed: {error}"
            )));
        }
    }

    wait_for_healthy_ready(ready_file, STARTUP_TIMEOUT)
        .await
        .ok_or_else(|| {
            HiveoryTerminalHostError::Operation("terminal host did not become ready".to_owned())
        })
}

async fn wait_for_healthy_ready(path: &Path, duration: Duration) -> Option<Endpoint> {
    let deadline = tokio::time::Instant::now() + duration;
    loop {
        if let Some(endpoint) = read_ready(path) {
            if health_check(&endpoint).await.is_ok() {
                return Some(endpoint);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return None;
        }
        sleep(Duration::from_millis(40)).await;
    }
}

fn lock_is_owned_by_live_host(lock_file: &Path, executable: &Path) -> bool {
    let Ok(contents) = std::fs::read_to_string(lock_file) else {
        return false;
    };
    let Ok(pid) = contents.trim().parse::<u32>() else {
        return false;
    };
    process_is_alive(pid, executable)
}

fn process_is_alive(pid: u32, executable: &Path) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("tasklist.exe");
        configure_background_command(&mut command);
        let filter = format!("PID eq {pid}");
        let output = command.args(["/FI", &filter, "/FO", "CSV", "/NH"]).output();
        let Ok(output) = output else {
            return false;
        };
        if !output.status.success() {
            return false;
        }
        let process_name = executable
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let text = String::from_utf8_lossy(&output.stdout);
        text.contains(&format!("\"{process_name}\"")) && text.contains(&format!(",\"{pid}\""))
    }
    #[cfg(not(windows))]
    {
        let _ = executable;
        Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

fn read_ready(path: &Path) -> Option<Endpoint> {
    let value = std::fs::read_to_string(path).ok()?;
    let ready = serde_json::from_str::<ReadyFile>(&value).ok()?;
    if ready.version != READY_FILE_VERSION || ready.port == 0 || ready.token.is_empty() {
        return None;
    }
    Some(Endpoint {
        port: ready.port,
        token: ready.token,
    })
}

async fn health_check(endpoint: &Endpoint) -> Result<(), HiveoryTerminalHostError> {
    let response = send_request(endpoint, HostRequest::Health).await?;
    if matches!(response, HostResponse::Health) {
        Ok(())
    } else {
        Err(HiveoryTerminalHostError::Operation(
            "terminal host health response was invalid".to_owned(),
        ))
    }
}

async fn send_request(
    endpoint: &Endpoint,
    request: HostRequest,
) -> Result<HostResponse, HiveoryTerminalHostError> {
    let mut stream = connect(endpoint).await?;
    let wire = WireRequest {
        token: endpoint.token.clone(),
        request,
    };
    write_json(&mut stream, &wire).await?;
    let (reader, _) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let response = read_json::<WireResponse, _>(&mut reader).await?;
    if response.ok {
        response.response.ok_or_else(|| {
            HiveoryTerminalHostError::Operation(
                "terminal host returned an empty response".to_owned(),
            )
        })
    } else {
        Err(host_error(response.error))
    }
}

async fn connect(endpoint: &Endpoint) -> Result<TcpStream, HiveoryTerminalHostError> {
    timeout(
        Duration::from_secs(2),
        TcpStream::connect(("127.0.0.1", endpoint.port)),
    )
    .await
    .map_err(|_| {
        HiveoryTerminalHostError::Operation("terminal host connection timed out".to_owned())
    })?
    .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))
}

async fn write_json<T: Serialize>(
    stream: &mut TcpStream,
    value: &T,
) -> Result<(), HiveoryTerminalHostError> {
    let mut line = serde_json::to_vec(value)
        .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?;
    line.push(b'\n');
    stream
        .write_all(&line)
        .await
        .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))
}

async fn read_json<T: for<'de> Deserialize<'de>, R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<T, HiveoryTerminalHostError> {
    let mut line = String::new();
    let bytes = reader
        .read_line(&mut line)
        .await
        .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?;
    if bytes == 0 {
        return Err(HiveoryTerminalHostError::Operation(
            "terminal host closed the connection".to_owned(),
        ));
    }
    serde_json::from_str(&line)
        .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))
}

fn is_transport_error(error: &HiveoryTerminalHostError) -> bool {
    matches!(error, HiveoryTerminalHostError::Operation(message) if message.contains("connection") || message.contains("closed") || message.contains("timed out"))
}

fn unexpected_response(response: HostResponse) -> HiveoryTerminalHostError {
    HiveoryTerminalHostError::Operation(format!(
        "terminal host returned an unexpected response: {response:?}"
    ))
}

fn host_error(error: Option<HostErrorPayload>) -> HiveoryTerminalHostError {
    let Some(error) = error else {
        return HiveoryTerminalHostError::Operation("terminal host request failed".to_owned());
    };
    match error.code.as_str() {
        "terminal_invalid_dimensions" => HiveoryTerminalHostError::InvalidDimensions,
        "code_adapter_unavailable" => HiveoryTerminalHostError::UnsupportedAdapter,
        "terminal_cancelled" => HiveoryTerminalHostError::Cancelled,
        "terminal_not_found" => HiveoryTerminalHostError::TerminalNotFound,
        _ => HiveoryTerminalHostError::Operation(error.message),
    }
}

#[derive(Debug, Clone)]
pub struct HostConfig {
    pub database_path: PathBuf,
    pub ready_file: PathBuf,
    pub lock_file: PathBuf,
    pub token: String,
    pub history_key_ref: String,
}

struct HistoryCipher {
    cipher: Aes256Gcm,
}

impl HistoryCipher {
    fn from_key(key: &[u8]) -> Result<Self, String> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|_| "terminal history key must contain 32 bytes".to_owned())?;
        Ok(Self { cipher })
    }

    fn from_key_reference(reference: &str) -> Result<Self, String> {
        let encoded = HiveoryKeyringSecretStore
            .get(reference)
            .map_err(|error| error.to_string())?;
        let key = STANDARD
            .decode(encoded)
            .map_err(|error| error.to_string())?;
        Self::from_key(&key)
    }

    fn encrypt(&self, terminal_id: &str, payload: &[u8]) -> Result<Vec<u8>, String> {
        let uuid = uuid::Uuid::now_v7();
        let nonce_bytes = &uuid.as_bytes()[..12];
        let encrypted = self
            .cipher
            .encrypt(
                Nonce::from_slice(nonce_bytes),
                aes_gcm::aead::Payload {
                    msg: payload,
                    aad: terminal_id.as_bytes(),
                },
            )
            .map_err(|_| "terminal history encryption failed".to_owned())?;
        let mut result = nonce_bytes.to_vec();
        result.extend(encrypted);
        Ok(result)
    }

    fn decrypt(&self, terminal_id: &str, payload: &[u8]) -> Result<Vec<u8>, String> {
        if payload.len() < 12 {
            return Err("terminal history record is truncated".to_owned());
        }
        self.cipher
            .decrypt(
                Nonce::from_slice(&payload[..12]),
                aes_gcm::aead::Payload {
                    msg: &payload[12..],
                    aad: terminal_id.as_bytes(),
                },
            )
            .map_err(|_| "terminal history decryption failed".to_owned())
    }
}

enum HistoryWork {
    Event(CodeTerminalEvent),
    Input { terminal_id: String, data: Vec<u8> },
}

struct StartHistoryGate {
    ready: AtomicBool,
    pending: Mutex<Vec<CodeTerminalEvent>>,
    tx: mpsc::UnboundedSender<HistoryWork>,
}

impl StartHistoryGate {
    fn push(&self, event: CodeTerminalEvent) {
        let mut pending = self.pending.lock().expect("history gate lock poisoned");
        if self.ready.load(Ordering::Acquire) {
            let _ = self.tx.send(HistoryWork::Event(event));
        } else {
            pending.push(event);
        }
    }

    fn activate(&self) {
        let mut pending = self.pending.lock().expect("history gate lock poisoned");
        self.ready.store(true, Ordering::Release);
        for event in pending.drain(..) {
            let _ = self.tx.send(HistoryWork::Event(event));
        }
    }
}

struct HostService {
    persistence: HiveoryPersistence,
    runtime: HiveoryCodeRuntime,
    history_cipher: Arc<HistoryCipher>,
    history_tx: mpsc::UnboundedSender<HistoryWork>,
    history_enabled: Arc<tokio::sync::RwLock<HashMap<String, bool>>>,
    host_instance_id: String,
}

impl HostService {
    async fn start(
        &self,
        request: CodeTerminalStartRequest,
        workspace_root: String,
        terminal_id: Option<String>,
        history_enabled: Option<bool>,
    ) -> Result<CodeTerminalSummary, HiveoryTerminalHostError> {
        let root = PathBuf::from(workspace_root);
        if !root.is_dir() {
            return Err(HiveoryTerminalHostError::Operation(
                "terminal workspace directory is unavailable".to_owned(),
            ));
        }

        let existing = if let Some(id) = terminal_id.as_deref() {
            self.persistence
                .code_terminal_session(id)
                .await
                .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?
        } else {
            None
        };
        if let Some(id) = terminal_id.as_deref() {
            if let Ok(summary) = self
                .runtime
                .list()
                .map(|summaries| summaries.into_iter().find(|summary| summary.id == id))
            {
                if let Some(summary) = summary {
                    if matches!(
                        summary.state,
                        hiveory_protocol::CodeTerminalState::Running
                            | hiveory_protocol::CodeTerminalState::Starting
                    ) {
                        self.history_enabled.write().await.insert(
                            id.to_owned(),
                            existing
                                .as_ref()
                                .map(|record| record.history_enabled)
                                .unwrap_or(true),
                        );
                        return Ok(summary);
                    }
                }
            }
        }

        let enabled = history_enabled
            .or_else(|| existing.as_ref().map(|record| record.history_enabled))
            .unwrap_or(true);
        let mut request = request;
        if request.resume_session_id.is_none() {
            request.resume_session_id = existing
                .as_ref()
                .and_then(|record| record.summary.session_id.clone());
        }
        let initial_sequence = self
            .persistence
            .code_terminal_history(terminal_id.as_deref().unwrap_or(""))
            .await
            .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?
            .into_iter()
            .map(|record| record.sequence)
            .max()
            .unwrap_or(0);
        let gate = Arc::new(StartHistoryGate {
            ready: AtomicBool::new(false),
            pending: Mutex::new(Vec::new()),
            tx: self.history_tx.clone(),
        });
        let sink_gate = gate.clone();
        let sink: TerminalEventSink = Arc::new(move |event| sink_gate.push(event));
        let summary = self
            .runtime
            .start_at_root_with_id(
                &request,
                &root,
                sink,
                terminal_id.as_deref(),
                initial_sequence,
            )
            .map_err(HiveoryTerminalHostError::from)?;
        if let Err(error) = self
            .persistence
            .save_code_terminal_session(
                &summary,
                &root.to_string_lossy(),
                request.cols,
                request.rows,
                enabled,
                &self.host_instance_id,
            )
            .await
        {
            let _ = self.runtime.stop(&CodeTerminalStopRequest {
                terminal_id: summary.id.clone(),
                force: true,
            });
            return Err(HiveoryTerminalHostError::Operation(error.to_string()));
        }
        self.history_enabled
            .write()
            .await
            .insert(summary.id.clone(), enabled);
        gate.activate();
        Ok(summary)
    }

    async fn list(&self) -> Result<Vec<CodeTerminalSummary>, HiveoryTerminalHostError> {
        self.runtime.list().map_err(Into::into)
    }

    async fn snapshot(
        &self,
        query: CodeTerminalSnapshotQuery,
    ) -> Result<CodeTerminalSnapshot, HiveoryTerminalHostError> {
        let live = self.runtime.snapshot(&query.terminal_id).ok();
        let session = self
            .persistence
            .code_terminal_session(&query.terminal_id)
            .await
            .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?;
        let Some(session) = session else {
            return live.ok_or(HiveoryTerminalHostError::TerminalNotFound);
        };

        if !session.history_enabled {
            return live.ok_or(HiveoryTerminalHostError::TerminalNotFound);
        }
        let records = self
            .persistence
            .code_terminal_history(&query.terminal_id)
            .await
            .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?;
        let (output, max_sequence) =
            decrypt_output(&self.history_cipher, &query.terminal_id, &records)?;
        if let Some(mut snapshot) = live {
            // The history worker is intentionally asynchronous. While it is
            // catching up, prefer the runtime's current ring buffer so a
            // snapshot never jumps backwards after a keypress/output burst.
            if !output.is_empty() && max_sequence >= snapshot.sequence {
                snapshot.output_base64 = STANDARD.encode(output);
            }
            snapshot.sequence = snapshot.sequence.max(max_sequence);
            return Ok(snapshot);
        }
        Ok(CodeTerminalSnapshot {
            summary: session.summary,
            cols: session.cols,
            rows: session.rows,
            output_base64: STANDARD.encode(output),
            sequence: max_sequence,
        })
    }

    async fn write(
        &self,
        request: CodeTerminalInputRequest,
    ) -> Result<(), HiveoryTerminalHostError> {
        self.runtime
            .write(&request)
            .map_err(HiveoryTerminalHostError::from)?;
        let enabled = if let Some(enabled) = self
            .history_enabled
            .read()
            .await
            .get(&request.terminal_id)
            .copied()
        {
            enabled
        } else {
            let enabled = self
                .persistence
                .code_terminal_session(&request.terminal_id)
                .await
                .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?
                .map(|record| record.history_enabled)
                .unwrap_or(true);
            self.history_enabled
                .write()
                .await
                .insert(request.terminal_id.clone(), enabled);
            enabled
        };
        if enabled {
            let data = STANDARD
                .decode(&request.data_base64)
                .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?;
            let _ = self.history_tx.send(HistoryWork::Input {
                terminal_id: request.terminal_id,
                data,
            });
        }
        Ok(())
    }

    async fn resize(
        &self,
        request: CodeTerminalResizeRequest,
    ) -> Result<bool, HiveoryTerminalHostError> {
        self.runtime.resize(&request).map_err(Into::into)
    }

    async fn stop(
        &self,
        request: CodeTerminalStopRequest,
    ) -> Result<bool, HiveoryTerminalHostError> {
        let stopped = self
            .runtime
            .stop(&request)
            .map_err(HiveoryTerminalHostError::from)?;
        if stopped {
            self.persistence
                .finish_code_terminal(
                    &request.terminal_id,
                    hiveory_protocol::CodeTerminalState::Interrupted,
                    None,
                )
                .await
                .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?;
        }
        Ok(stopped)
    }

    async fn set_history_enabled(
        &self,
        terminal_id: String,
        enabled: bool,
    ) -> Result<bool, HiveoryTerminalHostError> {
        let changed = self
            .persistence
            .set_code_terminal_history_enabled(&terminal_id, enabled)
            .await
            .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?;
        if changed {
            self.history_enabled
                .write()
                .await
                .insert(terminal_id, enabled);
        }
        Ok(changed)
    }
}

fn decrypt_output(
    cipher: &HistoryCipher,
    terminal_id: &str,
    records: &[CodeTerminalHistoryRecord],
) -> Result<(Vec<u8>, u64), HiveoryTerminalHostError> {
    let mut output = Vec::new();
    let mut max_sequence = 0;
    for record in records.iter().filter(|record| record.direction == "output") {
        let bytes = cipher
            .decrypt(terminal_id, &record.payload)
            .map_err(HiveoryTerminalHostError::Operation)?;
        output.extend(bytes);
        max_sequence = max_sequence.max(record.sequence);
    }
    Ok((output, max_sequence))
}

async fn history_worker(
    persistence: HiveoryPersistence,
    cipher: Arc<HistoryCipher>,
    history_enabled: Arc<tokio::sync::RwLock<HashMap<String, bool>>>,
    mut rx: mpsc::UnboundedReceiver<HistoryWork>,
) {
    while let Some(work) = rx.recv().await {
        let result: Result<(String, Vec<u8>), String> = match work {
            HistoryWork::Input { terminal_id, data } => cipher
                .encrypt(&terminal_id, &data)
                .map(|encrypted| (terminal_id, encrypted)),
            HistoryWork::Event(event) => {
                let terminal_id = event.terminal_id.clone();
                if !history_enabled
                    .read()
                    .await
                    .get(&terminal_id)
                    .copied()
                    .unwrap_or(true)
                {
                    continue;
                }
                let direction = if event.kind == CodeTerminalEventKind::Output {
                    "output"
                } else {
                    "event"
                };
                let payload = if event.kind == CodeTerminalEventKind::Output {
                    event
                        .data_base64
                        .as_deref()
                        .and_then(|data| STANDARD.decode(data).ok())
                        .unwrap_or_default()
                } else {
                    serde_json::to_vec(&event).unwrap_or_default()
                };
                match cipher.encrypt(&terminal_id, &payload) {
                    Ok(encrypted) => {
                        if persistence
                            .append_code_terminal_history(
                                &terminal_id,
                                direction,
                                event.sequence,
                                &encrypted,
                            )
                            .await
                            .is_ok()
                            && event.kind == CodeTerminalEventKind::Exited
                        {
                            let _ = persistence
                                .finish_code_terminal(
                                    &terminal_id,
                                    hiveory_protocol::CodeTerminalState::Exited,
                                    event.exit_code,
                                )
                                .await;
                        }
                    }
                    Err(_) => {}
                }
                continue;
            }
        };
        if let Ok((terminal_id, encrypted)) = result {
            // Input records have their own append order and do not consume
            // the PTY output sequence.  Zero is intentional here; output
            // events retain their monotonic sequence for resynchronisation.
            let sequence = 0;
            let _ = persistence
                .append_code_terminal_history(&terminal_id, "input", sequence, &encrypted)
                .await;
        }
    }
}

struct HostLock {
    _file: std::fs::File,
    lock_file: PathBuf,
    ready_file: PathBuf,
}

impl Drop for HostLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.ready_file);
        let _ = std::fs::remove_file(&self.lock_file);
    }
}

pub async fn run_server(config: HostConfig) -> Result<(), String> {
    let mut lock = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&config.lock_file)
        .map_err(|error| format!("terminal host lock failed: {error}"))?;
    writeln!(lock, "{}", std::process::id()).map_err(|error| error.to_string())?;
    let _lock = HostLock {
        _file: lock,
        lock_file: config.lock_file.clone(),
        ready_file: config.ready_file.clone(),
    };
    let persistence = HiveoryPersistence::open(&config.database_path)
        .await
        .map_err(|error| error.to_string())?;
    // The desktop application can close while this hidden host remains alive.
    // Starting or reconnecting the host therefore must never turn persisted live
    // sessions into dormant ones: host/runtime liveness is reconciled by the
    // caller before a pane renders an end-of-session state.
    let cipher = Arc::new(HistoryCipher::from_key_reference(&config.history_key_ref)?);
    let history_enabled = Arc::new(tokio::sync::RwLock::new(HashMap::new()));
    let (history_tx, history_rx) = mpsc::unbounded_channel();
    tokio::spawn(history_worker(
        persistence.clone(),
        cipher.clone(),
        history_enabled.clone(),
        history_rx,
    ));
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    write_ready(
        &config.ready_file,
        ReadyFile {
            version: READY_FILE_VERSION,
            port,
            token: config.token.clone(),
            pid: std::process::id(),
        },
    )?;
    let service = Arc::new(HostService {
        persistence,
        runtime: HiveoryCodeRuntime::new(),
        history_cipher: cipher,
        history_tx,
        history_enabled,
        host_instance_id: format!("host-{}", uuid::Uuid::now_v7()),
    });
    loop {
        let (stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let service = service.clone();
        let token = config.token.clone();
        tokio::spawn(async move {
            let _ = handle_connection(stream, token, service).await;
        });
    }
}

fn write_ready(path: &Path, ready: ReadyFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec(&ready).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    std::fs::rename(temporary, path).map_err(|error| error.to_string())
}

async fn handle_connection(
    stream: TcpStream,
    token: String,
    service: Arc<HostService>,
) -> Result<(), HiveoryTerminalHostError> {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let request = read_json::<WireRequest, _>(&mut reader).await?;
    if request.token != token {
        write_json_owned(
            &mut writer,
            &WireResponse {
                ok: false,
                response: None,
                error: Some(HostErrorPayload {
                    code: "unauthorized".to_owned(),
                    message: "terminal host authentication failed".to_owned(),
                }),
            },
        )
        .await?;
        return Ok(());
    }
    match request.request {
        HostRequest::Health => write_ok(&mut writer, HostResponse::Health).await?,
        HostRequest::Start {
            request,
            workspace_root,
            terminal_id,
            history_enabled,
        } => match service
            .start(request, workspace_root, terminal_id, history_enabled)
            .await
        {
            Ok(summary) => write_ok(&mut writer, HostResponse::Summary(summary)).await?,
            Err(error) => write_error(&mut writer, &error).await?,
        },
        HostRequest::List => match service.list().await {
            Ok(summaries) => write_ok(&mut writer, HostResponse::Summaries(summaries)).await?,
            Err(error) => write_error(&mut writer, &error).await?,
        },
        HostRequest::Snapshot(query) => match service.snapshot(query).await {
            Ok(snapshot) => write_ok(&mut writer, HostResponse::Snapshot(snapshot)).await?,
            Err(error) => write_error(&mut writer, &error).await?,
        },
        HostRequest::Write(request) => match service.write(request).await {
            Ok(()) => write_ok(&mut writer, HostResponse::Bool(true)).await?,
            Err(error) => write_error(&mut writer, &error).await?,
        },
        HostRequest::Resize(request) => match service.resize(request).await {
            Ok(value) => write_ok(&mut writer, HostResponse::Bool(value)).await?,
            Err(error) => write_error(&mut writer, &error).await?,
        },
        HostRequest::Stop(request) => match service.stop(request).await {
            Ok(value) => write_ok(&mut writer, HostResponse::Bool(value)).await?,
            Err(error) => write_error(&mut writer, &error).await?,
        },
        HostRequest::SetHistoryEnabled {
            terminal_id,
            enabled,
        } => match service.set_history_enabled(terminal_id, enabled).await {
            Ok(value) => write_ok(&mut writer, HostResponse::Bool(value)).await?,
            Err(error) => write_error(&mut writer, &error).await?,
        },
        HostRequest::Subscribe(request) => {
            let mut receiver = match service.runtime.subscribe(&request.terminal_id) {
                Ok(receiver) => receiver,
                Err(error) => {
                    write_error(&mut writer, &HiveoryTerminalHostError::from(error)).await?;
                    return Ok(());
                }
            };
            write_ok(&mut writer, HostResponse::SubscribeReady).await?;
            loop {
                match receiver.recv().await {
                    Ok(event) if event.sequence > request.after_sequence => {
                        let mut line =
                            serde_json::to_vec(&WireEvent { event }).map_err(|error| {
                                HiveoryTerminalHostError::Operation(error.to_string())
                            })?;
                        line.push(b'\n');
                        if writer.write_all(&line).await.is_err() {
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
    Ok(())
}

async fn write_ok(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    response: HostResponse,
) -> Result<(), HiveoryTerminalHostError> {
    write_json_owned(
        writer,
        &WireResponse {
            ok: true,
            response: Some(response),
            error: None,
        },
    )
    .await
}

async fn write_error(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    error: &HiveoryTerminalHostError,
) -> Result<(), HiveoryTerminalHostError> {
    let code = match error {
        HiveoryTerminalHostError::InvalidDimensions => "terminal_invalid_dimensions",
        HiveoryTerminalHostError::UnsupportedAdapter => "code_adapter_unavailable",
        HiveoryTerminalHostError::Cancelled => "terminal_cancelled",
        HiveoryTerminalHostError::TerminalNotFound => "terminal_not_found",
        HiveoryTerminalHostError::Operation(_) => "terminal_operation_failed",
    };
    write_json_owned(
        writer,
        &WireResponse {
            ok: false,
            response: None,
            error: Some(HostErrorPayload {
                code: code.to_owned(),
                message: error.to_string(),
            }),
        },
    )
    .await
}

async fn write_json_owned<T: Serialize>(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    value: &T,
) -> Result<(), HiveoryTerminalHostError> {
    let mut line = serde_json::to_vec(value)
        .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))?;
    line.push(b'\n');
    writer
        .write_all(&line)
        .await
        .map_err(|error| HiveoryTerminalHostError::Operation(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::HistoryCipher;

    #[test]
    fn history_cipher_round_trip_is_authenticated() {
        let cipher = HistoryCipher::from_key(&[7_u8; 32]).expect("valid history key");
        let encrypted = cipher
            .encrypt("terminal-1", b"input and output")
            .expect("encrypt history");
        assert_ne!(encrypted, b"input and output");
        assert_eq!(
            cipher
                .decrypt("terminal-1", &encrypted)
                .expect("decrypt history"),
            b"input and output"
        );
        assert!(cipher.decrypt("terminal-2", &encrypted).is_err());
    }

    #[test]
    fn history_cipher_rejects_invalid_keys() {
        assert!(HistoryCipher::from_key(&[0_u8; 31]).is_err());
    }
}
