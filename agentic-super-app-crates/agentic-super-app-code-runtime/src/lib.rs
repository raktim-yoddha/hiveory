//! PTY/ConPTY lifecycle and coding-agent adapter surfaces for Code mode.
//!
//! The runtime owns processes and never accepts a shell command string from
//! the renderer. Shell sessions use the user's configured shell; the coding
//! agent is launched through a structured, fixed adapter definition.

use agentic_super_app_protocol::{
    ChatProviderStreamEvent, ChatProviderStreamEventKind, CodeAdapterCapability,
    CodeAdapterSummary, CodeTerminalEvent, CodeTerminalEventKind, CodeTerminalInputRequest,
    CodeTerminalKind, CodeTerminalResizeRequest, CodeTerminalStartRequest, CodeTerminalState,
    CodeTerminalStopRequest, CodeTerminalSummary,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::Value;
use std::{
    collections::HashMap,
    ffi::{OsStr, OsString},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command as TokioCommand,
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

#[derive(Debug, Error)]
pub enum AgenticSuperAppCodeRuntimeError {
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
        let where_output = StdCommand::new("where.exe")
            .arg(name)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .ok();
        if let Some(output) = where_output {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let candidate = PathBuf::from(line.trim());
                if !candidate.is_file() {
                    continue;
                }
                if candidate
                    .extension()
                    .and_then(OsStr::to_str)
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("ps1"))
                {
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

fn command_with_prefix(program: &ResolvedExecutable) -> StdCommand {
    let mut command = StdCommand::new(&program.program);
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

struct TerminalSession {
    summary: Mutex<CodeTerminalSummary>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    process_group_id: Option<i32>,
}

#[derive(Clone, Default)]
pub struct AgenticSuperAppCodeRuntime {
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
}

impl AgenticSuperAppCodeRuntime {
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

    pub fn list(&self) -> Result<Vec<CodeTerminalSummary>, AgenticSuperAppCodeRuntimeError> {
        let sessions = self.sessions.lock().map_err(|_| {
            AgenticSuperAppCodeRuntimeError::Operation("terminal lock poisoned".to_owned())
        })?;
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
    ) -> Result<CodeTerminalSummary, AgenticSuperAppCodeRuntimeError> {
        self.start_at_root(request, workspace_root, sink)
    }

    /// Starts a terminal in a host-validated directory. The caller must keep
    /// the path inside an approved workspace or managed orchestration root.
    pub fn start_at_root(
        &self,
        request: &CodeTerminalStartRequest,
        workspace_root: &Path,
        sink: TerminalEventSink,
    ) -> Result<CodeTerminalSummary, AgenticSuperAppCodeRuntimeError> {
        if request.cols == 0 || request.rows == 0 || request.cols > 500 || request.rows > 500 {
            return Err(AgenticSuperAppCodeRuntimeError::InvalidDimensions);
        }
        let id = format!("terminal-{}", uuid::Uuid::now_v7());
        let started_at_unix_ms = now_ms();
        let mut command = command_for(request, workspace_root)?;
        command.cwd(workspace_root.as_os_str());
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
            .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?;
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?;
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
            .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?;
        drop(pair.slave);

        let summary = CodeTerminalSummary {
            id: id.clone(),
            workspace_id: request.workspace_id.clone(),
            kind: request.kind,
            state: CodeTerminalState::Running,
            pid,
            adapter_id: request.adapter_id.clone(),
            session_id: request.resume_session_id.clone(),
            exit_code: None,
            started_at_unix_ms,
            updated_at_unix_ms: started_at_unix_ms,
        };
        let session = Arc::new(TerminalSession {
            summary: Mutex::new(summary.clone()),
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            killer: Mutex::new(killer),
            process_group_id,
        });
        self.sessions
            .lock()
            .map_err(|_| {
                AgenticSuperAppCodeRuntimeError::Operation("terminal lock poisoned".to_owned())
            })?
            .insert(id.clone(), session.clone());
        emit(
            &sink,
            CodeTerminalEvent {
                terminal_id: id.clone(),
                kind: CodeTerminalEventKind::Started,
                data_base64: None,
                exit_code: None,
                message: None,
                emitted_at_unix_ms: now_ms(),
            },
        );

        std::thread::Builder::new()
            .name(format!("agentic-terminal-{id}"))
            .spawn(move || {
                let mut buffer = [0_u8; 16 * 1024];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(bytes_read) => emit(
                            &sink,
                            CodeTerminalEvent {
                                terminal_id: id.clone(),
                                kind: CodeTerminalEventKind::Output,
                                data_base64: Some(STANDARD.encode(&buffer[..bytes_read])),
                                exit_code: None,
                                message: None,
                                emitted_at_unix_ms: now_ms(),
                            },
                        ),
                        Err(error) => {
                            emit(
                                &sink,
                                CodeTerminalEvent {
                                    terminal_id: id.clone(),
                                    kind: CodeTerminalEventKind::Error,
                                    data_base64: None,
                                    exit_code: None,
                                    message: Some(error.to_string()),
                                    emitted_at_unix_ms: now_ms(),
                                },
                            );
                            break;
                        }
                    }
                }
                let exit_status = child.wait().ok();
                let exit_code = exit_status.as_ref().map(|status| status.exit_code() as i32);
                if let Ok(mut summary) = session.summary.lock() {
                    summary.state = if exit_status.is_some() {
                        CodeTerminalState::Exited
                    } else {
                        CodeTerminalState::Interrupted
                    };
                    summary.exit_code = exit_code;
                    summary.updated_at_unix_ms = now_ms();
                }
                emit(
                    &sink,
                    CodeTerminalEvent {
                        terminal_id: id.clone(),
                        kind: CodeTerminalEventKind::Exited,
                        data_base64: None,
                        exit_code,
                        message: exit_status.map(|status| status.to_string()),
                        emitted_at_unix_ms: now_ms(),
                    },
                );
            })
            .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?;
        Ok(summary)
    }

    pub fn write(
        &self,
        request: &CodeTerminalInputRequest,
    ) -> Result<(), AgenticSuperAppCodeRuntimeError> {
        let session = self.session(&request.terminal_id)?;
        let bytes = STANDARD
            .decode(&request.data)
            .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?;
        let result = session
            .writer
            .lock()
            .map_err(|_| {
                AgenticSuperAppCodeRuntimeError::Operation(
                    "terminal writer lock poisoned".to_owned(),
                )
            })?
            .write_all(&bytes)
            .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()));
        result
    }

    pub fn resize(
        &self,
        request: &CodeTerminalResizeRequest,
    ) -> Result<(), AgenticSuperAppCodeRuntimeError> {
        if request.cols == 0 || request.rows == 0 || request.cols > 500 || request.rows > 500 {
            return Err(AgenticSuperAppCodeRuntimeError::InvalidDimensions);
        }
        let session = self.session(&request.terminal_id)?;
        let result = session
            .master
            .lock()
            .map_err(|_| {
                AgenticSuperAppCodeRuntimeError::Operation(
                    "terminal master lock poisoned".to_owned(),
                )
            })?
            .resize(PtySize {
                rows: request.rows,
                cols: request.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()));
        result
    }

    pub fn stop(
        &self,
        request: &CodeTerminalStopRequest,
    ) -> Result<bool, AgenticSuperAppCodeRuntimeError> {
        let session = self.session(&request.terminal_id)?;
        let state = session
            .summary
            .lock()
            .map_err(|_| {
                AgenticSuperAppCodeRuntimeError::Operation("terminal lock poisoned".to_owned())
            })?
            .state;
        if matches!(
            state,
            CodeTerminalState::Exited | CodeTerminalState::Interrupted
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
                    AgenticSuperAppCodeRuntimeError::Operation(
                        "terminal killer lock poisoned".to_owned(),
                    )
                })?
                .kill()
                .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?;
        } else {
            session
                .writer
                .lock()
                .map_err(|_| {
                    AgenticSuperAppCodeRuntimeError::Operation(
                        "terminal writer lock poisoned".to_owned(),
                    )
                })?
                .write_all(b"\x03")
                .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?;
        }
        if let Ok(mut summary) = session.summary.lock() {
            summary.state = CodeTerminalState::Interrupted;
            summary.updated_at_unix_ms = now_ms();
        }
        Ok(true)
    }

    fn session(
        &self,
        terminal_id: &str,
    ) -> Result<Arc<TerminalSession>, AgenticSuperAppCodeRuntimeError> {
        self.sessions
            .lock()
            .map_err(|_| {
                AgenticSuperAppCodeRuntimeError::Operation("terminal lock poisoned".to_owned())
            })?
            .get(terminal_id)
            .cloned()
            .ok_or(AgenticSuperAppCodeRuntimeError::TerminalNotFound)
    }
}

fn command_for(
    request: &CodeTerminalStartRequest,
    workspace_root: &Path,
) -> Result<CommandBuilder, AgenticSuperAppCodeRuntimeError> {
    match request.kind {
        CodeTerminalKind::Shell => {
            let shell = shell_program();
            Ok(CommandBuilder::new(shell))
        }
        CodeTerminalKind::CodingAgent => {
            let adapter_id = request.adapter_id.as_deref().unwrap_or(CODEX_ADAPTER_ID);
            let spec = adapter_spec(adapter_id)
                .ok_or(AgenticSuperAppCodeRuntimeError::UnsupportedAdapter)?;
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
                    command.arg(workspace_root.as_os_str());
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
                _ => return Err(AgenticSuperAppCodeRuntimeError::UnsupportedAdapter),
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
    prompt: &str,
    cancellation: CancellationToken,
    on_event: Arc<dyn Fn(ChatProviderStreamEvent) + Send + Sync + 'static>,
) -> Result<(), AgenticSuperAppCodeRuntimeError> {
    let spec =
        adapter_spec(adapter_id).ok_or(AgenticSuperAppCodeRuntimeError::UnsupportedAdapter)?;
    let chat_root =
        std::env::temp_dir().join(format!("agentic-super-app-chat-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&chat_root)
        .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?;

    let mut command = cli_chat_command(spec, model, prompt, &chat_root);
    let child_result = command.spawn();
    let mut child = match child_result {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&chat_root);
            return Err(AgenticSuperAppCodeRuntimeError::Operation(format!(
                "{} could not be started: {}",
                spec.display_name, error
            )));
        }
    };
    let stdout = child.stdout.take().ok_or_else(|| {
        AgenticSuperAppCodeRuntimeError::Operation(format!(
            "{} did not expose stdout",
            spec.display_name
        ))
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        AgenticSuperAppCodeRuntimeError::Operation(format!(
            "{} did not expose stderr",
            spec.display_name
        ))
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
                return Err(AgenticSuperAppCodeRuntimeError::Cancelled);
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
            return Err(AgenticSuperAppCodeRuntimeError::Cancelled);
        }
        status = child.wait() => status.map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?,
    };
    let stderr = stderr_reader
        .await
        .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?
        .map_err(|error| AgenticSuperAppCodeRuntimeError::Operation(error.to_string()))?;
    let _ = std::fs::remove_dir_all(&chat_root);

    if let Some(error) = stream_error {
        return Err(AgenticSuperAppCodeRuntimeError::Operation(error));
    }
    if !status.success() {
        let detail = sanitize_cli_error(&String::from_utf8_lossy(&stderr));
        return Err(AgenticSuperAppCodeRuntimeError::Operation(
            if detail.is_empty() {
                format!("{} exited with status {}", spec.display_name, status)
            } else {
                format!("{}: {}", spec.display_name, detail)
            },
        ));
    }
    Ok(())
}

fn cli_chat_command(
    spec: AdapterSpec,
    model: &str,
    prompt: &str,
    chat_root: &Path,
) -> TokioCommand {
    let resolved = resolve_executable(spec.executable);
    let mut command = TokioCommand::new(resolved.program);
    command
        .args(resolved.prefix)
        .current_dir(chat_root)
        .env("AGENTIC_SUPER_APP_CHAT_MODE", "1")
        .env("AGENTIC_SUPER_APP_CHAT_ROOT", chat_root)
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
        let _ = StdCommand::new("taskkill")
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
        let adapters = AgenticSuperAppCodeRuntime::new().adapters();
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
        let runtime = AgenticSuperAppCodeRuntime::new();
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
            terminal_id: summary.id,
            force: true,
        });
        assert!(receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .is_ok());
    }
}
