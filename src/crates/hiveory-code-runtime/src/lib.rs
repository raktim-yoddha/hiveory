//! PTY/ConPTY lifecycle and coding-agent adapter surfaces for Code mode.
//!
//! The runtime owns processes and never accepts a shell command string from
//! the renderer. Shell sessions use the user's configured shell; the coding
//! agent is launched through a structured, fixed adapter definition.

use base64::{engine::general_purpose::STANDARD, Engine};
use hiveory_platform_process::configure_background_command;
use hiveory_protocol::{
    ChatEngineAvailability, ChatEngineSummary, ChatModelSummary, ChatProviderStreamEvent,
    ChatProviderStreamEventKind, ChatReasoningEffort, CodeAdapterCapability, CodeAdapterSummary,
    CodeTerminalEvent, CodeTerminalEventKind, CodeTerminalInputRequest, CodeTerminalKind,
    CodeTerminalResizeRequest, CodeTerminalStartRequest, CodeTerminalState,
    CodeTerminalStopRequest, CodeTerminalSummary,
};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::Value;
#[cfg(windows)]
use std::ffi::OsStr;
use std::{
    collections::HashMap,
    ffi::OsString,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command as TokioCommand,
    time::{timeout, Duration},
};
use tokio_util::sync::CancellationToken;

pub const CODEX_ADAPTER_ID: &str = "codex-cli";
pub const CODEX_EXECUTABLE: &str = "codex";
pub const CLAUDE_CODE_ADAPTER_ID: &str = "claude-code";
pub const CLAUDE_CODE_EXECUTABLE: &str = "claude";
pub const ANTIGRAVITY_ADAPTER_ID: &str = "antigravity";
pub const ANTIGRAVITY_EXECUTABLE: &str = "agy";
pub const OPENCODE_ADAPTER_ID: &str = "opencode";
pub const OPENCODE_EXECUTABLE: &str = "opencode";
pub type TerminalEventSink = Arc<dyn Fn(CodeTerminalEvent) + Send + Sync + 'static>;

fn process_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(unc_path) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc_path}"));
        }
        if let Some(local_path) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(local_path);
        }
    }
    path.to_path_buf()
}

#[derive(Debug, Error)]
pub enum HiveoryCodeRuntimeError {
    #[error("terminal dimensions are invalid")]
    InvalidDimensions,
    #[error("coding-agent adapter is not supported")]
    UnsupportedAdapter,
    #[error("coding-agent process was cancelled")]
    Cancelled,
    #[error("terminal was not found")]
    TerminalNotFound,
    #[error("terminal operation failed: {0}")]
    Operation(String),
}

#[derive(Clone, Copy)]
struct AdapterSpec {
    id: &'static str,
    display_name: &'static str,
    executable: &'static str,
}

const ADAPTER_SPECS: &[AdapterSpec] = &[
    AdapterSpec {
        id: CODEX_ADAPTER_ID,
        display_name: "Codex CLI",
        executable: CODEX_EXECUTABLE,
    },
    AdapterSpec {
        id: CLAUDE_CODE_ADAPTER_ID,
        display_name: "Claude Code",
        executable: CLAUDE_CODE_EXECUTABLE,
    },
    AdapterSpec {
        id: ANTIGRAVITY_ADAPTER_ID,
        display_name: "Antigravity",
        executable: ANTIGRAVITY_EXECUTABLE,
    },
    AdapterSpec {
        id: OPENCODE_ADAPTER_ID,
        display_name: "OpenCode",
        executable: OPENCODE_EXECUTABLE,
    },
];

#[derive(Clone, Debug)]
struct ResolvedExecutable {
    program: PathBuf,
    prefix: Vec<OsString>,
}

fn adapter_spec(id: &str) -> Option<AdapterSpec> {
    ADAPTER_SPECS.iter().copied().find(|spec| spec.id == id)
}

fn resolve_executable(name: &str) -> ResolvedExecutable {
    #[cfg(windows)]
    {
        let mut where_command = StdCommand::new("where.exe");
        configure_background_command(&mut where_command);
        let where_output = where_command
            .arg(name)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .ok();
        if let Some(output) = where_output {
            let mut candidates = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(|line| PathBuf::from(line.trim()))
                .filter(|candidate| candidate.is_file())
                .collect::<Vec<_>>();
            // `where.exe` can return npm's extensionless and .cmd shims before
            // the real executable. Prefer a directly runnable binary, then a
            // shell wrapper, and only use an extensionless path as a last
            // resort. This is what makes installed CLIs visible from Tauri as
            // well as from an interactive PowerShell session.
            candidates.sort_by_key(|candidate| executable_priority(candidate));
            if let Some(candidate) = candidates.into_iter().next() {
                let extension = candidate
                    .extension()
                    .and_then(OsStr::to_str)
                    .unwrap_or_default();
                if extension.eq_ignore_ascii_case("ps1") {
                    return ResolvedExecutable {
                        program: PathBuf::from("powershell.exe"),
                        prefix: vec![
                            OsString::from("-NoProfile"),
                            OsString::from("-ExecutionPolicy"),
                            OsString::from("Bypass"),
                            OsString::from("-File"),
                            candidate.into_os_string(),
                        ],
                    };
                }
                if extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat") {
                    return ResolvedExecutable {
                        program: PathBuf::from("cmd.exe"),
                        prefix: vec![
                            OsString::from("/D"),
                            OsString::from("/S"),
                            OsString::from("/C"),
                            candidate.into_os_string(),
                        ],
                    };
                }
                return ResolvedExecutable {
                    program: candidate,
                    prefix: Vec::new(),
                };
            }
        }
    }
    ResolvedExecutable {
        program: PathBuf::from(name),
        prefix: Vec::new(),
    }
}

#[cfg(windows)]
fn executable_priority(path: &Path) -> u8 {
    match path.extension().and_then(OsStr::to_str) {
        Some(extension) if extension.eq_ignore_ascii_case("exe") => 0,
        Some(extension) if extension.eq_ignore_ascii_case("com") => 1,
        Some(extension) if extension.eq_ignore_ascii_case("cmd") => 2,
        Some(extension) if extension.eq_ignore_ascii_case("bat") => 3,
        Some(extension) if extension.eq_ignore_ascii_case("ps1") => 4,
        _ => 5,
    }
}

fn command_with_prefix(program: &ResolvedExecutable) -> StdCommand {
    let mut command = StdCommand::new(&program.program);
    configure_background_command(&mut command);
    command.args(&program.prefix);
    command
}

fn probe_adapter(spec: AdapterSpec) -> bool {
    command_with_prefix(&resolve_executable(spec.executable))
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn probe_codex_authentication(detected: bool) -> bool {
    if !detected {
        return false;
    }
    let program = resolve_executable(CODEX_EXECUTABLE);
    command_with_prefix(&program)
        .args(["login", "status"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn adapter_capabilities(id: &str) -> Vec<CodeAdapterCapability> {
    let mut capabilities = vec![CodeAdapterCapability::ModelSelection];
    if matches!(
        id,
        CODEX_ADAPTER_ID | CLAUDE_CODE_ADAPTER_ID | OPENCODE_ADAPTER_ID
    ) {
        capabilities.push(CodeAdapterCapability::Resume);
    }
    if id == CODEX_ADAPTER_ID {
        capabilities.push(CodeAdapterCapability::ReasoningEffort);
    }
    capabilities.push(CodeAdapterCapability::PermissionModes);
    capabilities
}

async fn discover_chat_engine(spec: AdapterSpec) -> ChatEngineSummary {
    let detected = probe_adapter(spec);
    if !detected {
        return ChatEngineSummary {
            id: spec.id.to_owned(),
            display_name: spec.display_name.to_owned(),
            executable: spec.executable.to_owned(),
            availability: ChatEngineAvailability::Missing,
            detected: false,
            authenticated: false,
            models: Vec::new(),
            capabilities: adapter_capabilities(spec.id),
            message: Some(format!("{} was not found on this host.", spec.executable)),
            recovery_action: Some(format!(
                "Install {} and restart Hiveory.",
                spec.display_name
            )),
        };
    }

    let (authenticated, auth_message) = chat_authentication(spec).await;
    let models = match spec.id {
        CLAUDE_CODE_ADAPTER_ID if authenticated => claude_models(),
        ANTIGRAVITY_ADAPTER_ID if authenticated => {
            discover_antigravity_models(spec).await.unwrap_or_default()
        }
        _ if authenticated => discover_cli_models(spec).await.unwrap_or_default(),
        _ => Vec::new(),
    };
    let catalog_failed = authenticated && models.is_empty();
    let availability = if !authenticated {
        ChatEngineAvailability::Unauthenticated
    } else if catalog_failed {
        ChatEngineAvailability::Unavailable
    } else {
        ChatEngineAvailability::Ready
    };
    let message = if !authenticated {
        auth_message.or_else(|| {
            Some(format!(
                "{} is installed but not signed in.",
                spec.display_name
            ))
        })
    } else if catalog_failed {
        Some(format!(
            "{} could not provide a usable model list.",
            spec.display_name
        ))
    } else {
        None
    };
    let recovery_action = if !authenticated {
        Some(authentication_recovery(spec.id).to_owned())
    } else if catalog_failed {
        Some(
            "Check the CLI installation and run its model command once, then refresh Chat."
                .to_owned(),
        )
    } else {
        None
    };
    ChatEngineSummary {
        id: spec.id.to_owned(),
        display_name: spec.display_name.to_owned(),
        executable: spec.executable.to_owned(),
        availability,
        detected: true,
        authenticated,
        models,
        capabilities: adapter_capabilities(spec.id),
        message,
        recovery_action,
    }
}

async fn chat_authentication(spec: AdapterSpec) -> (bool, Option<String>) {
    match spec.id {
        CODEX_ADAPTER_ID => {
            if probe_codex_authentication(true) {
                (true, None)
            } else {
                (
                    false,
                    Some("Sign in with the CLI before using it in Chat.".to_owned()),
                )
            }
        }
        CLAUDE_CODE_ADAPTER_ID => {
            match run_cli_capture(spec, &["auth", "status", "--json"]).await {
                Ok(output) => {
                    let logged_in = serde_json::from_str::<Value>(&output)
                        .ok()
                        .and_then(|value| value.get("loggedIn").and_then(Value::as_bool))
                        .unwrap_or(false);
                    if logged_in {
                        (true, None)
                    } else {
                        (
                            false,
                            Some("Sign in with the CLI before using it in Chat.".to_owned()),
                        )
                    }
                }
                Err(error) => (false, Some(sanitize_cli_error(&error))),
            }
        }
        OPENCODE_ADAPTER_ID => match run_cli_capture(spec, &["auth", "list"]).await {
            Ok(output) if output.lines().any(|line| !line.trim().is_empty()) => (true, None),
            Ok(_) => (
                false,
                Some("Add a provider credential before using this CLI in Chat.".to_owned()),
            ),
            Err(error) => (false, Some(sanitize_cli_error(&error))),
        },
        // This CLI exposes a working model inventory rather than a separate
        // login-status command, so a successful inventory is its usability
        // check.
        ANTIGRAVITY_ADAPTER_ID => match run_cli_capture(spec, &["models"]).await {
            Ok(_) => (true, None),
            Err(error) => (false, Some(sanitize_cli_error(&error))),
        },
        _ => (false, Some("This CLI is not supported by Chat.".to_owned())),
    }
}

fn authentication_recovery(id: &str) -> &'static str {
    match id {
        CODEX_ADAPTER_ID => "Run `codex login` in a terminal, then refresh Chat.",
        CLAUDE_CODE_ADAPTER_ID => "Run `claude login` in a terminal, then refresh Chat.",
        OPENCODE_ADAPTER_ID => "Configure a provider with `opencode auth`, then refresh Chat.",
        ANTIGRAVITY_ADAPTER_ID => {
            "Open the CLI once and complete its sign-in flow, then refresh Chat."
        }
        _ => "Check the CLI configuration and refresh Chat.",
    }
}

fn claude_models() -> Vec<ChatModelSummary> {
    let effort_levels = vec![
        ChatReasoningEffort::Low,
        ChatReasoningEffort::Medium,
        ChatReasoningEffort::High,
        ChatReasoningEffort::Xhigh,
        ChatReasoningEffort::Max,
    ];
    [
        ("default", "CLI default"),
        ("sonnet", "Sonnet"),
        ("opus", "Opus"),
        ("haiku", "Haiku"),
    ]
    .into_iter()
    .map(|(id, display_name)| ChatModelSummary {
        id: id.to_owned(),
        display_name: display_name.to_owned(),
        effort_levels: effort_levels.clone(),
        default_effort: ChatReasoningEffort::Medium,
    })
    .collect()
}

async fn discover_antigravity_models(spec: AdapterSpec) -> Result<Vec<ChatModelSummary>, String> {
    let output = run_cli_capture(spec, &["models"]).await?;
    let models = output
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(2, '\t');
            let id = fields.next()?.trim();
            let display_name = fields.next().unwrap_or(id).trim();
            if id.is_empty() || id.eq_ignore_ascii_case("fetching available models...") {
                return None;
            }
            Some(ChatModelSummary {
                id: id.to_owned(),
                display_name: display_name.to_owned(),
                effort_levels: vec![
                    ChatReasoningEffort::Auto,
                    ChatReasoningEffort::Low,
                    ChatReasoningEffort::Medium,
                    ChatReasoningEffort::High,
                ],
                default_effort: ChatReasoningEffort::Auto,
            })
        })
        .collect::<Vec<_>>();
    (!models.is_empty())
        .then_some(models)
        .ok_or_else(|| "No models were returned by the CLI.".to_owned())
}

async fn discover_cli_models(spec: AdapterSpec) -> Result<Vec<ChatModelSummary>, String> {
    match spec.id {
        OPENCODE_ADAPTER_ID => {
            let output = run_cli_capture(spec, &["models", "--pure"]).await?;
            let models = output
                .lines()
                .filter_map(|line| {
                    let line = line.trim();
                    if line.is_empty() {
                        return None;
                    }
                    let mut fields = line.splitn(2, char::is_whitespace);
                    let id = fields.next()?.trim();
                    let display_name = fields.next().unwrap_or(id).trim();
                    Some(ChatModelSummary {
                        id: id.to_owned(),
                        display_name: if display_name.is_empty() {
                            id.to_owned()
                        } else {
                            display_name.to_owned()
                        },
                        effort_levels: vec![ChatReasoningEffort::Auto],
                        default_effort: ChatReasoningEffort::Auto,
                    })
                })
                .collect::<Vec<_>>();
            (!models.is_empty())
                .then_some(models)
                .ok_or_else(|| "No models were returned by the CLI.".to_owned())
        }
        CODEX_ADAPTER_ID => discover_codex_models(spec).await,
        _ => Err("This CLI does not expose a model catalog.".to_owned()),
    }
}

async fn discover_codex_models(spec: AdapterSpec) -> Result<Vec<ChatModelSummary>, String> {
    let resolved = resolve_executable(spec.executable);
    let mut command = TokioCommand::new(resolved.program);
    configure_background_command(command.as_std_mut());
    command
        .args(resolved.prefix)
        .args(["app-server", "--stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let mut input = child
        .stdin
        .take()
        .ok_or_else(|| "The CLI did not expose stdin.".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "The CLI did not expose stdout.".to_owned())?;
    let mut lines = BufReader::new(stdout).lines();
    write_json_line(
        &mut input,
        &serde_json::json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": { "name": "hiveory-chat", "title": "Hiveory Chat", "version": "1" },
                "capabilities": { "experimentalApi": true }
            }
        }),
    )
    .await?;
    let _ = read_json_rpc_response(&mut lines, 1).await?;
    write_json_line(
        &mut input,
        &serde_json::json!({ "method": "initialized", "params": {} }),
    )
    .await?;
    let mut cursor: Option<String> = None;
    let mut request_id = 2_i64;
    let mut models = Vec::new();
    loop {
        let params = cursor
            .as_ref()
            .map(|value| serde_json::json!({ "cursor": value }))
            .unwrap_or_else(|| serde_json::json!({}));
        write_json_line(
            &mut input,
            &serde_json::json!({ "method": "model/list", "id": request_id, "params": params }),
        )
        .await?;
        let response = read_json_rpc_response(&mut lines, request_id).await?;
        if let Some(error) = response.get("error").and_then(value_text) {
            return Err(error);
        }
        let result = response
            .get("result")
            .ok_or_else(|| "The model catalog response was incomplete.".to_owned())?;
        if let Some(items) = result.get("data").and_then(Value::as_array) {
            for item in items {
                if let Some(model) = codex_model(item) {
                    models.push(model);
                }
            }
        }
        cursor = result
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .filter(|value| !value.is_empty());
        if cursor.is_none() {
            break;
        }
        request_id += 1;
        if request_id > 32 {
            break;
        }
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
    (!models.is_empty())
        .then_some(models)
        .ok_or_else(|| "No models were returned by the CLI.".to_owned())
}

fn codex_model(value: &Value) -> Option<ChatModelSummary> {
    let id = value
        .get("model")
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)?
        .trim();
    if id.is_empty() {
        return None;
    }
    let display_name = value
        .get("displayName")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(id)
        .to_owned();
    let effort_levels = value
        .get("supportedReasoningEfforts")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("reasoningEffort")
                        .and_then(Value::as_str)
                        .and_then(parse_reasoning_effort)
                })
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| vec![ChatReasoningEffort::Auto]);
    let default_effort = value
        .get("defaultReasoningEffort")
        .and_then(Value::as_str)
        .and_then(parse_reasoning_effort)
        .unwrap_or(ChatReasoningEffort::Auto);
    Some(ChatModelSummary {
        id: id.to_owned(),
        display_name,
        effort_levels,
        default_effort,
    })
}

fn parse_reasoning_effort(value: &str) -> Option<ChatReasoningEffort> {
    match value {
        "auto" => Some(ChatReasoningEffort::Auto),
        "low" => Some(ChatReasoningEffort::Low),
        "medium" => Some(ChatReasoningEffort::Medium),
        "high" => Some(ChatReasoningEffort::High),
        "xhigh" => Some(ChatReasoningEffort::Xhigh),
        "max" => Some(ChatReasoningEffort::Max),
        "ultra" => Some(ChatReasoningEffort::Ultra),
        _ => None,
    }
}

async fn write_json_line(
    input: &mut tokio::process::ChildStdin,
    value: &Value,
) -> Result<(), String> {
    let mut line = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    line.push(b'\n');
    input
        .write_all(&line)
        .await
        .map_err(|error| error.to_string())
}

async fn read_json_rpc_response(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    request_id: i64,
) -> Result<Value, String> {
    loop {
        let line = timeout(Duration::from_secs(12), lines.next_line())
            .await
            .map_err(|_| "The CLI model catalog timed out.".to_owned())?
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "The CLI closed before returning its model catalog.".to_owned())?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let matches_id = value
            .get("id")
            .and_then(Value::as_i64)
            .map(|value| value == request_id)
            .unwrap_or(false);
        if matches_id {
            return Ok(value);
        }
    }
}

async fn run_cli_capture(spec: AdapterSpec, args: &[&str]) -> Result<String, String> {
    let resolved = resolve_executable(spec.executable);
    let mut command = TokioCommand::new(resolved.program);
    configure_background_command(command.as_std_mut());
    command
        .args(resolved.prefix)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = timeout(Duration::from_secs(12), command.output())
        .await
        .map_err(|_| format!("{} did not respond in time.", spec.display_name))?
        .map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = sanitize_cli_error(&String::from_utf8_lossy(&output.stderr));
        Err(if stderr.is_empty() {
            format!(
                "{} exited with status {}.",
                spec.display_name, output.status
            )
        } else {
            stderr
        })
    }
}

const MAX_RING_BUFFER_BYTES: usize = 1024 * 1024; // 1 MiB

struct TerminalSession {
    summary: Mutex<CodeTerminalSummary>,
    dimensions: Mutex<(u16, u16)>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    process_group_id: Option<i32>,
    ring_buffer: Mutex<std::collections::VecDeque<u8>>,
    sequence: std::sync::atomic::AtomicU64,
    broadcast_tx: tokio::sync::broadcast::Sender<CodeTerminalEvent>,
}

#[derive(Clone, Default)]
pub struct HiveoryCodeRuntime {
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
}

impl HiveoryCodeRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn adapters(&self) -> Vec<CodeAdapterSummary> {
        ADAPTER_SPECS
            .iter()
            .map(|spec| {
                let detected = probe_adapter(*spec);
                CodeAdapterSummary {
                    id: spec.id.to_owned(),
                    display_name: spec.display_name.to_owned(),
                    executable: spec.executable.to_owned(),
                    detected,
                    // Only Codex exposes a non-interactive auth status command
                    // we can probe without starting a billable generation. The
                    // other CLIs report credential errors when a turn starts.
                    authenticated: spec.id == CODEX_ADAPTER_ID
                        && probe_codex_authentication(detected),
                    capabilities: adapter_capabilities(spec.id),
                }
            })
            .collect()
    }

    /// Discovers the models and usability of every supported local CLI. The
    /// list is intentionally built at query time so the Chat picker reflects
    /// changes made outside the application without copying CLI-specific
    /// configuration into the database.
    pub async fn chat_engines(&self) -> Vec<ChatEngineSummary> {
        let mut engines = Vec::with_capacity(ADAPTER_SPECS.len());
        for spec in ADAPTER_SPECS {
            engines.push(discover_chat_engine(*spec).await);
        }
        engines
    }

    pub fn list(&self) -> Result<Vec<CodeTerminalSummary>, HiveoryCodeRuntimeError> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| HiveoryCodeRuntimeError::Operation("terminal lock poisoned".to_owned()))?;
        let mut summaries = sessions
            .values()
            .filter_map(|session| session.summary.lock().ok().map(|summary| summary.clone()))
            .collect::<Vec<_>>();
        summaries.sort_by_key(|summary| std::cmp::Reverse(summary.updated_at_unix_ms));
        Ok(summaries)
    }

    pub fn start(
        &self,
        request: &CodeTerminalStartRequest,
        workspace_root: &Path,
        sink: TerminalEventSink,
    ) -> Result<CodeTerminalSummary, HiveoryCodeRuntimeError> {
        self.start_at_root(request, workspace_root, sink)
    }

    /// Starts a terminal in a host-validated directory. The caller must keep
    /// the path inside an approved workspace or managed orchestration root.
    pub fn start_at_root(
        &self,
        request: &CodeTerminalStartRequest,
        workspace_root: &Path,
        sink: TerminalEventSink,
    ) -> Result<CodeTerminalSummary, HiveoryCodeRuntimeError> {
        if request.cols == 0 || request.rows == 0 || request.cols > 500 || request.rows > 500 {
            return Err(HiveoryCodeRuntimeError::InvalidDimensions);
        }
        let id = format!("terminal-{}", uuid::Uuid::now_v7());
        let started_at_unix_ms = now_ms();
        let process_root = process_path(workspace_root);
        let mut command = command_for(request, &process_root)?;
        command.cwd(process_root.as_os_str());
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: request.rows,
                cols: request.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?;
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?;
        let pid = child.process_id();
        let killer = child.clone_killer();
        let process_group_id = {
            #[cfg(unix)]
            {
                pair.master.process_group_leader()
            }
            #[cfg(not(unix))]
            {
                None
            }
        };
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?;
        drop(pair.slave);

        let summary = CodeTerminalSummary {
            id: id.clone(),
            workspace_id: request.workspace_id.clone(),
            kind: request.kind,
            state: CodeTerminalState::Running,
            pid,
            adapter_id: request.adapter_id.clone(),
            model: request.model.clone(),
            session_id: request.resume_session_id.clone(),
            exit_code: None,
            started_at_unix_ms,
            updated_at_unix_ms: started_at_unix_ms,
        };
        let (broadcast_tx, _) = tokio::sync::broadcast::channel(2048);
        let session = Arc::new(TerminalSession {
            summary: Mutex::new(summary.clone()),
            dimensions: Mutex::new((request.cols, request.rows)),
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            killer: Mutex::new(killer),
            process_group_id,
            ring_buffer: Mutex::new(std::collections::VecDeque::with_capacity(16 * 1024)),
            sequence: std::sync::atomic::AtomicU64::new(0),
            broadcast_tx: broadcast_tx.clone(),
        });
        self.sessions
            .lock()
            .map_err(|_| HiveoryCodeRuntimeError::Operation("terminal lock poisoned".to_owned()))?
            .insert(id.clone(), session.clone());

        let start_ev = CodeTerminalEvent {
            terminal_id: id.clone(),
            sequence: session
                .sequence
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                + 1,
            kind: CodeTerminalEventKind::Started,
            data_base64: None,
            exit_code: None,
            message: None,
            emitted_at_unix_ms: now_ms(),
        };
        let _ = broadcast_tx.send(start_ev.clone());
        emit(&sink, start_ev);

        let bg_session = session.clone();
        let bg_id = id.clone();
        std::thread::Builder::new()
            .name(format!("hiveory-terminal-{id}"))
            .spawn(move || {
                let mut buffer = [0_u8; 16 * 1024];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(bytes_read) => {
                            if let Ok(mut rb) = bg_session.ring_buffer.lock() {
                                for b in &buffer[..bytes_read] {
                                    if rb.len() >= MAX_RING_BUFFER_BYTES {
                                        rb.pop_front();
                                    }
                                    rb.push_back(*b);
                                }
                            }
                            let sequence = bg_session
                                .sequence
                                .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                                + 1;
                            let ev = CodeTerminalEvent {
                                terminal_id: bg_id.clone(),
                                sequence,
                                kind: CodeTerminalEventKind::Output,
                                data_base64: Some(STANDARD.encode(&buffer[..bytes_read])),
                                exit_code: None,
                                message: None,
                                emitted_at_unix_ms: now_ms(),
                            };
                            let _ = bg_session.broadcast_tx.send(ev.clone());
                            emit(&sink, ev);
                        }
                        Err(error) => {
                            let ev = CodeTerminalEvent {
                                terminal_id: bg_id.clone(),
                                sequence: bg_session
                                    .sequence
                                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                                    + 1,
                                kind: CodeTerminalEventKind::Error,
                                data_base64: None,
                                exit_code: None,
                                message: Some(error.to_string()),
                                emitted_at_unix_ms: now_ms(),
                            };
                            let _ = bg_session.broadcast_tx.send(ev.clone());
                            emit(&sink, ev);
                            break;
                        }
                    }
                }
                let exit_status = child.wait().ok();
                let exit_code = exit_status.as_ref().map(|status| status.exit_code() as i32);
                if let Ok(mut summary) = bg_session.summary.lock() {
                    summary.state = if exit_status.is_some() {
                        CodeTerminalState::Exited
                    } else {
                        CodeTerminalState::Interrupted
                    };
                    summary.exit_code = exit_code;
                    summary.updated_at_unix_ms = now_ms();
                }
                let exit_ev = CodeTerminalEvent {
                    terminal_id: bg_id.clone(),
                    sequence: bg_session
                        .sequence
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                        + 1,
                    kind: CodeTerminalEventKind::Exited,
                    data_base64: None,
                    exit_code,
                    message: exit_status.map(|status| status.to_string()),
                    emitted_at_unix_ms: now_ms(),
                };
                let _ = bg_session.broadcast_tx.send(exit_ev.clone());
                emit(&sink, exit_ev);
            })
            .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?;
        Ok(summary)
    }

    pub fn snapshot(
        &self,
        terminal_id: &str,
    ) -> Result<hiveory_protocol::CodeTerminalSnapshot, HiveoryCodeRuntimeError> {
        let session = self.session(terminal_id)?;
        let summary = session
            .summary
            .lock()
            .map_err(|_| HiveoryCodeRuntimeError::Operation("lock poisoned".to_owned()))?
            .clone();
        let (cols, rows) = *session
            .dimensions
            .lock()
            .map_err(|_| HiveoryCodeRuntimeError::Operation("lock poisoned".to_owned()))?;
        let output_base64 = {
            let rb = session
                .ring_buffer
                .lock()
                .map_err(|_| HiveoryCodeRuntimeError::Operation("lock poisoned".to_owned()))?;
            let bytes: Vec<u8> = rb.iter().copied().collect();
            STANDARD.encode(&bytes)
        };
        let sequence = session.sequence.load(std::sync::atomic::Ordering::Relaxed);
        Ok(hiveory_protocol::CodeTerminalSnapshot {
            summary,
            cols,
            rows,
            output_base64,
            sequence,
        })
    }

    pub fn subscribe(
        &self,
        terminal_id: &str,
    ) -> Result<tokio::sync::broadcast::Receiver<CodeTerminalEvent>, HiveoryCodeRuntimeError> {
        let session = self.session(terminal_id)?;
        Ok(session.broadcast_tx.subscribe())
    }

    pub fn write(&self, request: &CodeTerminalInputRequest) -> Result<(), HiveoryCodeRuntimeError> {
        let session = self.session(&request.terminal_id)?;
        let bytes = STANDARD
            .decode(&request.data_base64)
            .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?;
        let mut writer = session.writer.lock().map_err(|_| {
            HiveoryCodeRuntimeError::Operation("terminal writer lock poisoned".to_owned())
        })?;
        writer
            .write_all(&bytes)
            .and_then(|_| writer.flush())
            .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))
    }

    pub fn resize(
        &self,
        request: &CodeTerminalResizeRequest,
    ) -> Result<bool, HiveoryCodeRuntimeError> {
        if request.cols == 0 || request.rows == 0 || request.cols > 500 || request.rows > 500 {
            return Err(HiveoryCodeRuntimeError::InvalidDimensions);
        }
        let session = self.session(&request.terminal_id)?;
        let state = session
            .summary
            .lock()
            .map_err(|_| HiveoryCodeRuntimeError::Operation("terminal lock poisoned".to_owned()))?
            .state;
        if matches!(
            state,
            CodeTerminalState::Exited
                | CodeTerminalState::Failed
                | CodeTerminalState::Interrupted
                | CodeTerminalState::Dormant
        ) {
            return Ok(false);
        }
        if let Ok(mut dims) = session.dimensions.lock() {
            *dims = (request.cols, request.rows);
        }
        let result = session
            .master
            .lock()
            .map_err(|_| {
                HiveoryCodeRuntimeError::Operation("terminal master lock poisoned".to_owned())
            })?
            .resize(PtySize {
                rows: request.rows,
                cols: request.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()));
        match result {
            Ok(()) => Ok(true),
            // A resize can race the child exiting. The terminal is already
            // unusable in that case, so report a clean no-op to the renderer
            // instead of surfacing an OS-specific handle error.
            Err(_) => Ok(false),
        }
    }

    pub fn stop(&self, request: &CodeTerminalStopRequest) -> Result<bool, HiveoryCodeRuntimeError> {
        let session = self.session(&request.terminal_id)?;
        let state = session
            .summary
            .lock()
            .map_err(|_| HiveoryCodeRuntimeError::Operation("terminal lock poisoned".to_owned()))?
            .state;
        if matches!(
            state,
            CodeTerminalState::Exited
                | CodeTerminalState::Failed
                | CodeTerminalState::Interrupted
                | CodeTerminalState::Dormant
        ) {
            return Ok(false);
        }
        if request.force {
            terminate_process_tree(
                session.summary.lock().ok().and_then(|summary| summary.pid),
                session.process_group_id,
            );
            session
                .killer
                .lock()
                .map_err(|_| {
                    HiveoryCodeRuntimeError::Operation("terminal killer lock poisoned".to_owned())
                })?
                .kill()
                .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?;
        } else {
            session
                .writer
                .lock()
                .map_err(|_| {
                    HiveoryCodeRuntimeError::Operation("terminal writer lock poisoned".to_owned())
                })?
                .write_all(b"\x03")
                .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?;
        }
        if let Ok(mut summary) = session.summary.lock() {
            summary.state = CodeTerminalState::Interrupted;
            summary.updated_at_unix_ms = now_ms();
        }
        Ok(true)
    }

    fn session(&self, terminal_id: &str) -> Result<Arc<TerminalSession>, HiveoryCodeRuntimeError> {
        self.sessions
            .lock()
            .map_err(|_| HiveoryCodeRuntimeError::Operation("terminal lock poisoned".to_owned()))?
            .get(terminal_id)
            .cloned()
            .ok_or(HiveoryCodeRuntimeError::TerminalNotFound)
    }
}

fn command_for(
    request: &CodeTerminalStartRequest,
    workspace_root: &Path,
) -> Result<CommandBuilder, HiveoryCodeRuntimeError> {
    match request.kind {
        CodeTerminalKind::Shell => {
            let shell = shell_program();
            Ok(CommandBuilder::new(shell))
        }
        CodeTerminalKind::CodingAgent => {
            let adapter_id = request.adapter_id.as_deref().unwrap_or(CODEX_ADAPTER_ID);
            let spec =
                adapter_spec(adapter_id).ok_or(HiveoryCodeRuntimeError::UnsupportedAdapter)?;
            let resolved = resolve_executable(spec.executable);
            let mut command = CommandBuilder::new(resolved.program);
            command.args(resolved.prefix);
            let resume_session_id = request.resume_session_id.as_deref();

            match spec.id {
                CODEX_ADAPTER_ID => {
                    if resume_session_id.is_some() {
                        command.arg("resume");
                    }
                    command.args([
                        "--sandbox",
                        "workspace-write",
                        "--ask-for-approval",
                        "on-request",
                    ]);
                    command.arg("--cd");
                    command.arg(process_path(workspace_root).as_os_str());
                    if let Some(session_id) = resume_session_id {
                        command.arg(session_id);
                    }
                }
                CLAUDE_CODE_ADAPTER_ID => {
                    command.args(["--permission-mode", "acceptEdits"]);
                    if let Some(session_id) = resume_session_id {
                        command.args(["--resume", session_id]);
                    }
                }
                ANTIGRAVITY_ADAPTER_ID => {}
                OPENCODE_ADAPTER_ID => {
                    if let Some(session_id) = resume_session_id {
                        command.args(["--session", session_id]);
                    }
                }
                _ => return Err(HiveoryCodeRuntimeError::UnsupportedAdapter),
            }
            if let Some(model) = request
                .model
                .as_deref()
                .filter(|model| !model.trim().is_empty() && *model != "default")
            {
                command.args(["--model", model]);
            }
            Ok(command)
        }
    }
}

/// Streams a provider-neutral Chat response from one of the installed coding
/// CLIs. Chat gets a fresh temporary directory and the commands are launched
/// in read-only/no-tool modes where the CLI supports that distinction, so a
/// chat turn cannot accidentally inherit a Code workspace.
pub async fn stream_cli_chat_turn(
    adapter_id: &str,
    model: &str,
    reasoning_effort: ChatReasoningEffort,
    prompt: &str,
    cancellation: CancellationToken,
    on_event: Arc<dyn Fn(ChatProviderStreamEvent) + Send + Sync + 'static>,
) -> Result<(), HiveoryCodeRuntimeError> {
    let spec = adapter_spec(adapter_id).ok_or(HiveoryCodeRuntimeError::UnsupportedAdapter)?;
    let chat_root = std::env::temp_dir().join(format!("hiveory-chat-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&chat_root)
        .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?;

    let mut command = cli_chat_command(spec, model, reasoning_effort, prompt, &chat_root);
    let child_result = command.spawn();
    let mut child = match child_result {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&chat_root);
            return Err(HiveoryCodeRuntimeError::Operation(format!(
                "{} could not be started: {}",
                spec.display_name, error
            )));
        }
    };
    let stdout = child.stdout.take().ok_or_else(|| {
        HiveoryCodeRuntimeError::Operation(format!("{} did not expose stdout", spec.display_name))
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        HiveoryCodeRuntimeError::Operation(format!("{} did not expose stderr", spec.display_name))
    })?;
    let stderr_reader = tokio::spawn(read_cli_stderr(stderr));
    let mut lines = BufReader::new(stdout).lines();
    let mut emitted_text = String::new();
    let mut sequence = 0_i64;
    let mut stream_error: Option<String> = None;

    loop {
        tokio::select! {
            _ = cancellation.cancelled() => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                stderr_reader.abort();
                let _ = std::fs::remove_dir_all(&chat_root);
                return Err(HiveoryCodeRuntimeError::Cancelled);
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        process_cli_json_line(
                            spec.id,
                            &line,
                            &on_event,
                            &mut emitted_text,
                            &mut sequence,
                            &mut stream_error,
                        );
                    }
                    Ok(None) => break,
                    Err(error) => {
                        stream_error = Some(format!("{} output could not be read: {}", spec.display_name, error));
                        break;
                    }
                }
            }
        }
    }

    let status = tokio::select! {
        _ = cancellation.cancelled() => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            stderr_reader.abort();
            let _ = std::fs::remove_dir_all(&chat_root);
            return Err(HiveoryCodeRuntimeError::Cancelled);
        }
        status = child.wait() => status.map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?,
    };
    let stderr = stderr_reader
        .await
        .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?
        .map_err(|error| HiveoryCodeRuntimeError::Operation(error.to_string()))?;
    let _ = std::fs::remove_dir_all(&chat_root);

    if let Some(error) = stream_error {
        return Err(HiveoryCodeRuntimeError::Operation(error));
    }
    if !status.success() {
        let detail = sanitize_cli_error(&String::from_utf8_lossy(&stderr));
        return Err(HiveoryCodeRuntimeError::Operation(if detail.is_empty() {
            format!("{} exited with status {}", spec.display_name, status)
        } else {
            format!("{}: {}", spec.display_name, detail)
        }));
    }
    Ok(())
}

fn cli_chat_command(
    spec: AdapterSpec,
    model: &str,
    reasoning_effort: ChatReasoningEffort,
    prompt: &str,
    chat_root: &Path,
) -> TokioCommand {
    let resolved = resolve_executable(spec.executable);
    let mut command = TokioCommand::new(resolved.program);
    configure_background_command(command.as_std_mut());
    command
        .args(resolved.prefix)
        .current_dir(chat_root)
        .env("HIVEORY_CHAT_MODE", "1")
        .env("HIVEORY_CHAT_ROOT", chat_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    match spec.id {
        CODEX_ADAPTER_ID => {
            command.args([
                "exec",
                "--json",
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                "--ephemeral",
                "--cd",
            ]);
            command.arg(chat_root);
            append_model_arg(&mut command, model);
            append_effort_arg(&mut command, spec.id, reasoning_effort);
            command.arg(prompt);
        }
        CLAUDE_CODE_ADAPTER_ID => {
            command.args([
                "-p",
                prompt,
                "--output-format",
                "stream-json",
                "--bare",
                "--no-session-persistence",
                "--tools",
                "",
            ]);
            append_model_arg(&mut command, model);
            append_effort_arg(&mut command, spec.id, reasoning_effort);
        }
        ANTIGRAVITY_ADAPTER_ID => {
            command.args([
                "-p",
                prompt,
                "--output-format",
                "stream-json",
                "--disable-slash-commands",
            ]);
            append_model_arg(&mut command, model);
            append_effort_arg(&mut command, spec.id, reasoning_effort);
        }
        OPENCODE_ADAPTER_ID => {
            command.args(["run", "--format", "json", "--pure", "--dir"]);
            command.arg(chat_root);
            append_model_arg(&mut command, model);
            command.arg(prompt);
        }
        _ => {}
    }
    command
}

fn append_effort_arg(command: &mut TokioCommand, adapter_id: &str, effort: ChatReasoningEffort) {
    let Some(value) = reasoning_effort_value(effort) else {
        return;
    };
    match adapter_id {
        CODEX_ADAPTER_ID => {
            command.args(["--config", &format!("model_reasoning_effort={value}")]);
        }
        CLAUDE_CODE_ADAPTER_ID | ANTIGRAVITY_ADAPTER_ID => {
            command.args(["--effort", value]);
        }
        _ => {}
    }
}

fn reasoning_effort_value(effort: ChatReasoningEffort) -> Option<&'static str> {
    match effort {
        ChatReasoningEffort::Auto => None,
        ChatReasoningEffort::Low => Some("low"),
        ChatReasoningEffort::Medium => Some("medium"),
        ChatReasoningEffort::High => Some("high"),
        ChatReasoningEffort::Xhigh => Some("xhigh"),
        ChatReasoningEffort::Max => Some("max"),
        ChatReasoningEffort::Ultra => Some("ultra"),
    }
}

fn append_model_arg(command: &mut TokioCommand, model: &str) {
    if !model.trim().is_empty() && model.trim() != "default" {
        command.args(["--model", model.trim()]);
    }
}

async fn read_cli_stderr(
    mut stderr: tokio::process::ChildStderr,
) -> Result<Vec<u8>, std::io::Error> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let bytes_read = stderr.read(&mut buffer).await?;
        if bytes_read == 0 {
            break;
        }
        let remaining = (32_usize * 1024).saturating_sub(output.len());
        if remaining > 0 {
            output.extend_from_slice(&buffer[..bytes_read.min(remaining)]);
        }
    }
    Ok(output)
}

fn process_cli_json_line(
    adapter_id: &str,
    line: &str,
    on_event: &Arc<dyn Fn(ChatProviderStreamEvent) + Send + Sync + 'static>,
    emitted_text: &mut String,
    sequence: &mut i64,
    stream_error: &mut Option<String>,
) {
    let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
        return;
    };
    if let Some(error) = cli_error_message(&value) {
        let message = sanitize_cli_error(&error);
        *stream_error = Some(format!("{}: {}", adapter_id, message));
        emit_cli_event(
            on_event,
            sequence,
            ChatProviderStreamEventKind::Failed,
            Some(message),
            None,
            None,
            Some(format!("{adapter_id}_failed")),
        );
        return;
    }
    let (input_tokens, output_tokens) = cli_usage(&value);
    if input_tokens.is_some() || output_tokens.is_some() {
        emit_cli_event(
            on_event,
            sequence,
            ChatProviderStreamEventKind::Usage,
            None,
            input_tokens,
            output_tokens,
            None,
        );
    }
    for (text, cumulative) in cli_text_candidates(&value) {
        let delta = if cumulative {
            if text.starts_with(emitted_text.as_str()) {
                text[emitted_text.len()..].to_owned()
            } else if emitted_text.starts_with(text.as_str()) {
                String::new()
            } else {
                text.clone()
            }
        } else {
            text
        };
        if delta.is_empty() {
            continue;
        }
        emitted_text.push_str(&delta);
        emit_cli_event(
            on_event,
            sequence,
            ChatProviderStreamEventKind::TextDelta,
            Some(delta),
            None,
            None,
            None,
        );
    }
}

fn emit_cli_event(
    on_event: &Arc<dyn Fn(ChatProviderStreamEvent) + Send + Sync + 'static>,
    sequence: &mut i64,
    kind: ChatProviderStreamEventKind,
    text: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    error_code: Option<String>,
) {
    on_event(ChatProviderStreamEvent {
        provider_sequence: *sequence,
        kind,
        text,
        input_tokens,
        output_tokens,
        error_code,
    });
    *sequence = sequence.saturating_add(1);
}

fn cli_text_candidates(value: &Value) -> Vec<(String, bool)> {
    let mut candidates = Vec::new();
    let Some(object) = value.as_object() else {
        return candidates;
    };
    let event_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if event_type == "stream_event" {
        if let Some(event) = object.get("event") {
            candidates.extend(cli_text_candidates(event));
        }
        return candidates;
    }
    if let Some(delta) = object.get("delta") {
        if let Some(text) = value_text(delta) {
            candidates.push((text, false));
        }
    }
    if event_type == "text" {
        if let Some(text) = object.get("part").and_then(value_text) {
            candidates.push((text, false));
        } else if let Some(text) = object.get("text").and_then(value_text) {
            candidates.push((text, false));
        }
    }
    let cumulative = matches!(
        event_type,
        "assistant" | "message" | "result" | "response.completed" | "item.completed" | "completed"
    );
    if cumulative {
        for key in [
            "result",
            "text",
            "output_text",
            "item",
            "message",
            "content",
        ] {
            if let Some(text) = object.get(key).and_then(value_text) {
                candidates.push((text, true));
                break;
            }
        }
    }
    candidates
}

fn value_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return (!text.is_empty()).then_some(text.to_owned());
    }
    if let Some(array) = value.as_array() {
        let text = array
            .iter()
            .filter_map(value_text)
            .collect::<Vec<_>>()
            .join("");
        return (!text.is_empty()).then_some(text);
    }
    let object = value.as_object()?;
    for key in ["text", "output_text", "result", "content"] {
        if let Some(text) = object.get(key).and_then(value_text) {
            return Some(text);
        }
    }
    None
}

fn cli_usage(value: &Value) -> (Option<u64>, Option<u64>) {
    if let Some(object) = value.as_object() {
        if let Some(usage) = object.get("usage") {
            let direct = usage_tokens(usage);
            if direct.0.is_some() || direct.1.is_some() {
                return direct;
            }
        }
        let direct = usage_tokens(value);
        if direct.0.is_some() || direct.1.is_some() {
            return direct;
        }
        for nested in object.values() {
            let found = cli_usage(nested);
            if found.0.is_some() || found.1.is_some() {
                return found;
            }
        }
    } else if let Some(array) = value.as_array() {
        for nested in array {
            let found = cli_usage(nested);
            if found.0.is_some() || found.1.is_some() {
                return found;
            }
        }
    }
    (None, None)
}

fn usage_tokens(value: &Value) -> (Option<u64>, Option<u64>) {
    let Some(object) = value.as_object() else {
        return (None, None);
    };
    let input = ["input_tokens", "inputTokens", "prompt_tokens"]
        .iter()
        .find_map(|key| object.get(*key).and_then(value_u64));
    let output = ["output_tokens", "outputTokens", "completion_tokens"]
        .iter()
        .find_map(|key| object.get(*key).and_then(value_u64));
    (input, output)
}

fn value_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
}

fn cli_error_message(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    let event_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !(event_type == "error" || event_type.ends_with(".error") || event_type.contains("failed")) {
        if let Some(error) = object.get("error") {
            if let Some(text) = value_text(error) {
                return Some(text);
            }
        }
        return None;
    }
    ["message", "error", "result", "detail"]
        .iter()
        .find_map(|key| object.get(*key).and_then(value_text))
        .or_else(|| Some(event_type.to_owned()))
}

fn sanitize_cli_error(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\t'))
        .collect::<String>()
        .trim()
        .chars()
        .take(800)
        .collect()
}

fn shell_program() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("COMSPEC")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("cmd.exe"))
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("SHELL")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/bin/sh"))
    }
}

fn terminate_process_tree(pid: Option<u32>, _process_group_id: Option<i32>) {
    let Some(pid) = pid else { return };
    #[cfg(windows)]
    {
        let mut command = StdCommand::new("taskkill");
        configure_background_command(&mut command);
        let _ = command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        if let Some(group_id) = _process_group_id {
            // portable-pty creates a dedicated session for Unix PTYs; signal
            // the process group so child processes do not survive the pane.
            unsafe {
                let _ = libc::kill(-group_id, libc::SIGHUP);
            }
        } else {
            unsafe {
                let _ = libc::kill(pid as i32, libc::SIGHUP);
            }
        }
    }
}

fn emit(sink: &TerminalEventSink, event: CodeTerminalEvent) {
    sink(event);
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn discovers_a_structured_codex_adapter_without_exposing_probe_output() {
        let adapters = HiveoryCodeRuntime::new().adapters();
        assert_eq!(adapters[0].id, CODEX_ADAPTER_ID);
        assert_eq!(adapters[0].executable, CODEX_EXECUTABLE);
        assert!(adapters
            .iter()
            .any(|adapter| adapter.id == CLAUDE_CODE_ADAPTER_ID));
        assert!(adapters
            .iter()
            .any(|adapter| adapter.id == ANTIGRAVITY_ADAPTER_ID));
        assert!(adapters
            .iter()
            .any(|adapter| adapter.id == OPENCODE_ADAPTER_ID));
    }

    #[test]
    fn normalizes_cli_delta_and_cumulative_result_without_duplication() {
        let events = Arc::new(Mutex::new(Vec::<ChatProviderStreamEvent>::new()));
        let captured = events.clone();
        let callback: Arc<dyn Fn(ChatProviderStreamEvent) + Send + Sync + 'static> =
            Arc::new(move |event| captured.lock().unwrap().push(event));
        let mut text = String::new();
        let mut sequence = 0;
        let mut error = None;
        process_cli_json_line(
            CODEX_ADAPTER_ID,
            r#"{"type":"response.output_text.delta","delta":"Hello "}"#,
            &callback,
            &mut text,
            &mut sequence,
            &mut error,
        );
        process_cli_json_line(
            CODEX_ADAPTER_ID,
            r#"{"type":"result","result":"Hello world"}"#,
            &callback,
            &mut text,
            &mut sequence,
            &mut error,
        );
        let events = events.lock().unwrap();
        assert_eq!(text, "Hello world");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].text.as_deref(), Some("Hello "));
        assert_eq!(events[1].text.as_deref(), Some("world"));
        assert!(error.is_none());
    }

    #[test]
    fn starts_a_shell_and_emits_output() {
        let runtime = HiveoryCodeRuntime::new();
        let (sender, receiver) = mpsc::channel();
        let sink: TerminalEventSink = Arc::new(move |event| {
            let _ = sender.send(event);
        });
        let root = std::env::current_dir().unwrap();
        let summary = runtime
            .start(
                &CodeTerminalStartRequest {
                    workspace_id: "test".to_owned(),
                    kind: CodeTerminalKind::Shell,
                    cols: 80,
                    rows: 24,
                    adapter_id: None,
                    model: None,
                    resume_session_id: None,
                },
                &root,
                sink,
            )
            .unwrap();
        let _ = runtime.stop(&CodeTerminalStopRequest {
            terminal_id: summary.id.clone(),
            force: true,
        });
        assert!(receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .is_ok());

        let snapshot = runtime.snapshot(&summary.id).unwrap();
        assert_eq!(snapshot.summary.id, summary.id);
        assert_eq!(snapshot.cols, 80);
        assert_eq!(snapshot.rows, 24);
        assert!(snapshot.sequence >= 1);
    }

    #[test]
    fn writes_utf8_base64_input_to_a_shell() {
        let runtime = HiveoryCodeRuntime::new();
        let (sender, receiver) = mpsc::channel();
        let sink: TerminalEventSink = Arc::new(move |event| {
            let _ = sender.send(event);
        });
        let root = std::env::current_dir().unwrap();
        let summary = runtime
            .start(
                &CodeTerminalStartRequest {
                    workspace_id: "test".to_owned(),
                    kind: CodeTerminalKind::Shell,
                    cols: 80,
                    rows: 24,
                    adapter_id: None,
                    model: None,
                    resume_session_id: None,
                },
                &root,
                sink,
            )
            .unwrap();

        // Let the interactive shell finish its initial prompt before writing,
        // matching the point at which an attached xterm can accept input.
        let startup_deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
        while std::time::Instant::now() < startup_deadline {
            let Ok(event) = receiver.recv_timeout(std::time::Duration::from_millis(100)) else {
                continue;
            };
            if event.kind == CodeTerminalEventKind::Output {
                break;
            }
        }

        runtime
            .write(&CodeTerminalInputRequest {
                terminal_id: summary.id.clone(),
                // cmd.exe asks the attached terminal for its cursor position
                // during startup. Answer that query before pressing Enter.
                data_base64: STANDARD.encode("\x1b[1;1Recho phase11\r".as_bytes()),
            })
            .unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut saw_echo = false;
        while std::time::Instant::now() < deadline {
            let Ok(event) = receiver.recv_timeout(std::time::Duration::from_millis(100)) else {
                continue;
            };
            if event.kind == CodeTerminalEventKind::Output {
                let bytes = event
                    .data_base64
                    .as_deref()
                    .and_then(|value| STANDARD.decode(value).ok())
                    .unwrap_or_default();
                if String::from_utf8_lossy(&bytes).contains("phase11") {
                    saw_echo = true;
                    break;
                }
            }
        }
        let _ = runtime.stop(&CodeTerminalStopRequest {
            terminal_id: summary.id,
            force: true,
        });
        assert!(saw_echo, "shell did not echo the base64-decoded input");
    }
}
