//! PTY/ConPTY lifecycle and coding-agent adapter surfaces for Code mode.
//!
//! The runtime owns processes and never accepts a shell command string from
//! the renderer. Shell sessions use the user's configured shell; the coding
//! agent is launched through a structured, fixed adapter definition.

use agentic_super_app_protocol::{
    CodeAdapterCapability, CodeAdapterSummary, CodeTerminalEvent, CodeTerminalEventKind,
    CodeTerminalInputRequest, CodeTerminalKind, CodeTerminalResizeRequest,
    CodeTerminalStartRequest, CodeTerminalState, CodeTerminalStopRequest, CodeTerminalSummary,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;

pub const CODEX_ADAPTER_ID: &str = "codex";
pub type TerminalEventSink = Arc<dyn Fn(CodeTerminalEvent) + Send + Sync + 'static>;

#[derive(Debug, Error)]
pub enum AgenticSuperAppCodeRuntimeError {
    #[error("terminal dimensions are invalid")]
    InvalidDimensions,
    #[error("coding-agent adapter is not supported")]
    UnsupportedAdapter,
    #[error("terminal was not found")]
    TerminalNotFound,
    #[error("terminal operation failed: {0}")]
    Operation(String),
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
        let detected = Command::new(CODEX_ADAPTER_ID)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);
        let authenticated = detected
            && Command::new(CODEX_ADAPTER_ID)
                .args(["login", "status"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false);
        vec![CodeAdapterSummary {
            id: CODEX_ADAPTER_ID.to_owned(),
            display_name: "Codex CLI".to_owned(),
            executable: CODEX_ADAPTER_ID.to_owned(),
            detected,
            authenticated,
            capabilities: vec![
                CodeAdapterCapability::Resume,
                CodeAdapterCapability::ModelSelection,
                CodeAdapterCapability::ReasoningEffort,
                CodeAdapterCapability::PermissionModes,
            ],
        }]
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
            if request.adapter_id.as_deref().unwrap_or(CODEX_ADAPTER_ID) != CODEX_ADAPTER_ID {
                return Err(AgenticSuperAppCodeRuntimeError::UnsupportedAdapter);
            }
            let mut command = CommandBuilder::new(CODEX_ADAPTER_ID);
            if let Some(session_id) = &request.resume_session_id {
                command.arg("resume");
                command.arg(session_id);
            }
            command.args([
                "--sandbox",
                "workspace-write",
                "--ask-for-approval",
                "on-request",
            ]);
            command.arg("--cd");
            command.arg(workspace_root.as_os_str());
            if let Some(model) = request
                .model
                .as_deref()
                .filter(|model| !model.trim().is_empty())
            {
                command.arg("--model");
                command.arg(model);
            }
            Ok(command)
        }
    }
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
        let _ = Command::new("taskkill")
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
        assert_eq!(adapters[0].executable, CODEX_ADAPTER_ID);
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
