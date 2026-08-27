#![allow(clippy::result_large_err)]

use agentic_super_app_artifact_store::{
    AgenticSuperAppArtifactError, AgenticSuperAppArtifactStore, AgenticSuperAppStoredAttachment,
};
use agentic_super_app_chat_domain::{estimate_context_tokens, validate_send_request};
use agentic_super_app_code_domain::{default_layout, validate_layout};
use agentic_super_app_code_orchestration::{
    AgenticSuperAppCodeOrchestration, AgenticSuperAppCodeOrchestrationError,
};
use agentic_super_app_code_runtime::{
    AgenticSuperAppCodeRuntime, AgenticSuperAppCodeRuntimeError, TerminalEventSink,
    CODEX_ADAPTER_ID,
};
use agentic_super_app_git_service::{AgenticSuperAppGitError, AgenticSuperAppGitService};
use agentic_super_app_job_runtime::AgenticSuperAppJobRuntime;
use agentic_super_app_model_gateway::{
    AgenticSuperAppModelProvider, AgenticSuperAppOpenAiResponsesProvider,
    AgenticSuperAppProviderError,
};
use agentic_super_app_notification_service::AgenticSuperAppNotificationService;
use agentic_super_app_persistence::{
    chat::{AgenticSuperAppChatStore, AgenticSuperAppChatStoreError},
    AgenticSuperAppPersistence, AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID,
};
use agentic_super_app_protocol::{
    current_protocol_version, ApiError, ApplicationMode, BootstrapSnapshot, BuildInformation,
    ChatAttachmentImportRequest, ChatBranchRequest, ChatConversationDetail, ChatCreateRequest,
    ChatDeleteRequest, ChatDraftRequest, ChatEditRequest, ChatEventEnvelope, ChatEventsQuery,
    ChatExportRequest, ChatMessagePart, ChatMetadataRequest, ChatModelTurnRequest,
    ChatProviderMessage, ChatProviderPart, ChatProviderStreamEvent, ChatReasoningEffort,
    ChatSendRequest, ChatSidebarPage, ChatSidebarQuery, ChatStreamRequest, ChatTurnRequest,
    CodeCheckpointDiffRequest, CodeCleanupConfirmRequest, CodeCleanupPreview,
    CodeCleanupPreviewRequest, CodeDagProposal, CodeDagProposalAcceptRequest,
    CodeDagProposalRequest, CodeDocument, CodeFileTree, CodeFileTreeQuery, CodeGitDiff,
    CodeGitDiffRequest, CodeGitStatus, CodeGitStatusRequest, CodeOrchestrationEventEnvelope,
    CodeOrchestrationEventsQuery, CodePaneLayout, CodePreviewRequest, CodePreviewState,
    CodePreviewSummary, CodeQuestionAnswerRequest, CodeReadFileRequest, CodeReviewRequest,
    CodeRunCreateRequest, CodeRunDetail, CodeRunRequest, CodeRunSummary, CodeRunUpdateRequest,
    CodeSaveFileRequest, CodeSaveLayoutRequest, CodeSnapshot, CodeTaskCreateRequest,
    CodeTaskDeleteRequest, CodeTaskRetryRequest, CodeTaskUpdateRequest, CodeTerminalEvent,
    CodeTerminalInputRequest, CodeTerminalResizeRequest, CodeTerminalStartRequest,
    CodeTerminalStopRequest, CodeTerminalSummary, CodeWorkspaceDetail, CodeWorkspaceOpenRequest,
    CodeWorkspaceQuery, CodeWorkspaceTrust, CodeWorkspaceTrustRequest, CommandEnvelope,
    DiagnosticSnapshot, JobState, ProviderDiagnosticRequest, ResponseEnvelope, RetryClass,
    SetActiveModeCommand, SharedEventEnvelope, AGENTIC_SUPER_APP_PROTOCOL_VERSION,
};
use agentic_super_app_secret_store::{
    AgenticSuperAppKeyringSecretStore, AgenticSuperAppSecretStoreHandle,
};
use agentic_super_app_tool_runtime::AgenticSuperAppAuditLog;
use agentic_super_app_workspace_service::{
    AgenticSuperAppWorkspaceError, AgenticSuperAppWorkspaceService,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;

struct AgenticSuperAppShellState {
    active_mode: RwLock<ApplicationMode>,
}
impl Default for AgenticSuperAppShellState {
    fn default() -> Self {
        Self {
            active_mode: RwLock::new(ApplicationMode::Agent),
        }
    }
}

#[derive(Clone)]
struct AgenticSuperAppFoundation {
    persistence: AgenticSuperAppPersistence,
    secrets: AgenticSuperAppSecretStoreHandle,
    provider: Arc<dyn AgenticSuperAppModelProvider>,
    jobs: AgenticSuperAppJobRuntime,
    notifications: AgenticSuperAppNotificationService,
    audit: AgenticSuperAppAuditLog,
    chat: AgenticSuperAppChatStore,
    artifacts: AgenticSuperAppArtifactStore,
    chat_events: broadcast::Sender<ChatEventEnvelope>,
    chat_cancellations: Arc<std::sync::Mutex<HashMap<String, CancellationToken>>>,
    recovery_message: Arc<RwLock<Option<String>>>,
    code_workspaces: AgenticSuperAppWorkspaceService,
    code_runtime: AgenticSuperAppCodeRuntime,
    code_git: AgenticSuperAppGitService,
    code_orchestration: AgenticSuperAppCodeOrchestration,
    code_active_workspace_id: Arc<RwLock<Option<String>>>,
}

impl AgenticSuperAppFoundation {
    async fn open(
        database_path: PathBuf,
        artifact_root: PathBuf,
        orchestration_root: PathBuf,
    ) -> Result<Self, String> {
        let persistence = AgenticSuperAppPersistence::open(&database_path)
            .await
            .map_err(|error| error.to_string())?;
        let code_workspaces = AgenticSuperAppWorkspaceService::new();
        let persisted_workspaces = persistence
            .code_workspaces()
            .await
            .map_err(|error| error.to_string())?;
        for summary in &persisted_workspaces {
            let _ = code_workspaces.open_workspace(
                Path::new(&summary.root_path),
                Some(&summary.id),
                summary.trust,
            );
        }
        let code_active_workspace_id = Arc::new(RwLock::new(
            persisted_workspaces
                .first()
                .map(|summary| summary.id.clone()),
        ));
        let code_orchestration = AgenticSuperAppCodeOrchestration::new(
            persistence.clone(),
            code_workspaces.clone(),
            orchestration_root,
        );
        let interrupted_orchestration = code_orchestration
            .recover()
            .await
            .map_err(|error| error.to_string())?;
        let interrupted = persistence
            .interrupt_active_jobs()
            .await
            .map_err(|error| error.to_string())?;
        persistence
            .interrupt_active_code_terminals()
            .await
            .map_err(|error| error.to_string())?;
        let chat = AgenticSuperAppChatStore::new(persistence.clone());
        let interrupted_chats = chat
            .interrupt_active_turns()
            .await
            .map_err(|error| error.to_string())?;
        let recovery_message =
            if interrupted > 0 || interrupted_chats > 0 || interrupted_orchestration > 0 {
                Some(format!(
                    "Recovered {} interrupted operation(s) after restart.",
                    interrupted + interrupted_chats + interrupted_orchestration
                ))
            } else {
                None
            };
        let jobs = AgenticSuperAppJobRuntime::new(persistence.clone());
        let secrets: AgenticSuperAppSecretStoreHandle = Arc::new(AgenticSuperAppKeyringSecretStore);
        let provider: Arc<dyn AgenticSuperAppModelProvider> =
            Arc::new(AgenticSuperAppOpenAiResponsesProvider::new(secrets.clone()));
        let notifications =
            AgenticSuperAppNotificationService::new(persistence.clone(), jobs.clone());
        let audit = AgenticSuperAppAuditLog::new(persistence.clone());
        let (chat_events, _) = broadcast::channel(512);
        Ok(Self {
            persistence,
            secrets,
            provider,
            jobs,
            notifications,
            audit,
            chat,
            artifacts: AgenticSuperAppArtifactStore::new(artifact_root),
            chat_events,
            chat_cancellations: Arc::new(std::sync::Mutex::new(HashMap::new())),
            recovery_message: Arc::new(RwLock::new(recovery_message)),
            code_workspaces,
            code_runtime: AgenticSuperAppCodeRuntime::new(),
            code_git: AgenticSuperAppGitService,
            code_orchestration,
            code_active_workspace_id,
        })
    }
    async fn diagnostic_snapshot(&self) -> Result<DiagnosticSnapshot, ApiError> {
        Ok(DiagnosticSnapshot {
            providers: self
                .persistence
                .provider_accounts()
                .await
                .map_err(database_error)?,
            recent_jobs: self
                .persistence
                .recent_jobs()
                .await
                .map_err(database_error)?,
            notifications: self
                .persistence
                .notifications()
                .await
                .map_err(database_error)?,
            recovery_message: self
                .recovery_message
                .read()
                .map_err(|_| unavailable_error())?
                .clone(),
        })
    }

    async fn code_snapshot(&self) -> Result<CodeSnapshot, ApiError> {
        Ok(CodeSnapshot {
            workspaces: self.code_workspaces.summaries().map_err(workspace_error)?,
            active_workspace_id: self
                .code_active_workspace_id
                .read()
                .map_err(|_| unavailable_error())?
                .clone(),
            adapters: self.code_runtime.adapters(),
        })
    }

    async fn code_detail(&self, workspace_id: &str) -> Result<CodeWorkspaceDetail, ApiError> {
        let summary = self
            .code_workspaces
            .summary(workspace_id)
            .map_err(workspace_error)?;
        let layout = match self
            .persistence
            .code_layout(workspace_id)
            .await
            .map_err(database_error)?
        {
            Some(layout)
                if layout.workspace_id == workspace_id && validate_layout(&layout).is_ok() =>
            {
                layout
            }
            _ => default_layout(workspace_id),
        };
        let mut terminals = self
            .persistence
            .code_terminals(workspace_id)
            .await
            .map_err(database_error)?;
        for terminal in self
            .code_runtime
            .list()
            .map_err(runtime_error)?
            .into_iter()
            .filter(|terminal| terminal.workspace_id == workspace_id)
        {
            if let Some(existing) = terminals.iter_mut().find(|item| item.id == terminal.id) {
                *existing = terminal;
            } else {
                terminals.push(terminal);
            }
        }
        Ok(CodeWorkspaceDetail {
            summary,
            layout,
            open_documents: self
                .persistence
                .code_documents(workspace_id)
                .await
                .map_err(database_error)?,
            terminals,
            previews: self
                .persistence
                .code_previews(workspace_id)
                .await
                .map_err(database_error)?,
        })
    }
}

#[tauri::command]
fn agentic_super_app_query_bootstrap(
    state: State<'_, AgenticSuperAppShellState>,
) -> Result<BootstrapSnapshot, ApiError> {
    let active_mode = *state.active_mode.read().map_err(|_| unavailable_error())?;
    Ok(BootstrapSnapshot {
        protocol: current_protocol_version(),
        active_mode,
        product_name: "Agentic Super App".to_owned(),
    })
}
#[tauri::command]
fn agentic_super_app_command_set_active_mode(
    command: SetActiveModeCommand,
    state: State<'_, AgenticSuperAppShellState>,
) -> Result<BootstrapSnapshot, ApiError> {
    let mut active_mode = state.active_mode.write().map_err(|_| unavailable_error())?;
    *active_mode = command.mode;
    Ok(BootstrapSnapshot {
        protocol: current_protocol_version(),
        active_mode: *active_mode,
        product_name: "Agentic Super App".to_owned(),
    })
}
#[tauri::command]
fn agentic_super_app_query_build_information() -> BuildInformation {
    BuildInformation {
        product_name: "Agentic Super App".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        protocol: current_protocol_version(),
    }
}
#[tauri::command]
async fn agentic_super_app_query_diagnostic_snapshot(
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<DiagnosticSnapshot, ApiError> {
    foundation.diagnostic_snapshot().await
}

#[tauri::command]
async fn agentic_super_app_query_code_snapshot(
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<CodeSnapshot, ApiError> {
    foundation.code_snapshot().await
}

#[tauri::command]
async fn agentic_super_app_query_code_workspace(
    query: CodeWorkspaceQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<CodeWorkspaceDetail, ApiError> {
    let workspace_id = query
        .workspace_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation_error("A workspace is required."))?;
    foundation.code_detail(&workspace_id).await
}

#[tauri::command]
async fn agentic_super_app_query_code_runs(
    workspace_id: Option<String>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<CodeRunSummary>, ApiError> {
    foundation
        .code_orchestration
        .runs(workspace_id.as_deref())
        .await
        .map_err(orchestration_error)
}

#[tauri::command]
async fn agentic_super_app_query_code_run(
    run_id: String,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<CodeRunDetail, ApiError> {
    foundation
        .code_orchestration
        .detail(&run_id)
        .await
        .map_err(orchestration_error)
}

#[tauri::command]
async fn agentic_super_app_query_code_orchestration_events(
    query: CodeOrchestrationEventsQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<CodeOrchestrationEventEnvelope>, ApiError> {
    foundation
        .persistence
        .orchestration_events(
            &query.run_id,
            query.after_sequence,
            query.limit.unwrap_or(500),
        )
        .await
        .map_err(database_error)
}

#[tauri::command]
async fn agentic_super_app_stream_code_orchestration_events(
    query: CodeOrchestrationEventsQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
    channel: Channel<CodeOrchestrationEventEnvelope>,
) -> Result<(), ApiError> {
    let mut receiver = foundation.code_orchestration.subscribe();
    let backlog = foundation
        .persistence
        .orchestration_events(
            &query.run_id,
            query.after_sequence,
            query.limit.unwrap_or(500),
        )
        .await
        .map_err(database_error)?;
    let mut cursor = query.after_sequence;
    for event in backlog {
        cursor = cursor.max(event.sequence);
        if channel.send(event).is_err() {
            return Ok(());
        }
    }
    let run_id = query.run_id;
    let after_sequence = cursor;
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = receiver.recv().await {
            if event.run_id != run_id || event.sequence <= after_sequence {
                continue;
            }
            if channel.send(event).is_err() {
                break;
            }
        }
    });
    Ok(())
}

#[tauri::command]
async fn agentic_super_app_command_create_code_run(
    command: CommandEnvelope<CodeRunCreateRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .create_run(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_update_code_run(
    command: CommandEnvelope<CodeRunUpdateRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .update_run(
            &command.payload.run_id,
            &command.payload.title,
            &command.payload.objective,
            command.payload.review_policy,
            command.payload.concurrency_limit,
        )
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_create_code_task(
    command: CommandEnvelope<CodeTaskCreateRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .create_task(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_update_code_task(
    command: CommandEnvelope<CodeTaskUpdateRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .update_task(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_delete_code_task(
    command: CommandEnvelope<CodeTaskDeleteRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .delete_task(&command.payload.run_id, &command.payload.task_id)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_propose_code_dag(
    command: CommandEnvelope<CodeDagProposalRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeDagProposal>, ApiError> {
    validate_code_command(&command)?;
    let proposal = foundation
        .code_orchestration
        .propose_dag(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, proposal))
}

#[tauri::command]
async fn agentic_super_app_command_accept_code_dag(
    command: CommandEnvelope<CodeDagProposalAcceptRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .accept_proposal(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_start_code_run(
    command: CommandEnvelope<CodeRunRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .start_run(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_pause_code_run(
    command: CommandEnvelope<CodeRunRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .pause_run(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_cancel_code_run(
    command: CommandEnvelope<CodeRunRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .cancel_run(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_answer_code_question(
    command: CommandEnvelope<CodeQuestionAnswerRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .answer_question(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_retry_code_task(
    command: CommandEnvelope<CodeTaskRetryRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .retry_task(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_review_code_checkpoint(
    command: CommandEnvelope<CodeReviewRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .review_checkpoint(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_query_code_cleanup_preview(
    request: CodeCleanupPreviewRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<CodeCleanupPreview, ApiError> {
    foundation
        .code_orchestration
        .cleanup_preview(&request)
        .await
        .map_err(orchestration_error)
}

#[tauri::command]
async fn agentic_super_app_query_code_checkpoint_diff(
    request: CodeCheckpointDiffRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<CodeGitDiff, ApiError> {
    foundation
        .code_orchestration
        .checkpoint_diff(&request)
        .await
        .map_err(orchestration_error)
}

#[tauri::command]
async fn agentic_super_app_command_confirm_code_cleanup(
    command: CommandEnvelope<CodeCleanupConfirmRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .cleanup_confirm(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_open_code_workspace(
    command: CommandEnvelope<CodeWorkspaceOpenRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeWorkspaceDetail>, ApiError> {
    validate_code_command(&command)?;
    let path = command.payload.path.trim();
    if path.is_empty() {
        return Err(validation_error("Choose a workspace folder first."));
    }
    let summary = foundation
        .code_workspaces
        .open_workspace(Path::new(path), None, CodeWorkspaceTrust::Untrusted)
        .map_err(workspace_error)?;
    foundation
        .persistence
        .save_code_workspace(&summary)
        .await
        .map_err(database_error)?;
    foundation
        .persistence
        .save_code_layout(&default_layout(&summary.id))
        .await
        .map_err(database_error)?;
    *foundation
        .code_active_workspace_id
        .write()
        .map_err(|_| unavailable_error())? = Some(summary.id.clone());
    foundation
        .audit
        .record(
            "code.workspace.open",
            "success",
            "info",
            Some(&summary.id),
            Some("workspace opened with untrusted defaults"),
        )
        .await
        .map_err(database_error)?;
    Ok(response(
        &command.request_id,
        foundation.code_detail(&summary.id).await?,
    ))
}

#[tauri::command]
async fn agentic_super_app_command_trust_code_workspace(
    command: CommandEnvelope<CodeWorkspaceTrustRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeWorkspaceDetail>, ApiError> {
    validate_code_command(&command)?;
    let trust = if command.payload.grant {
        CodeWorkspaceTrust::Trusted
    } else {
        CodeWorkspaceTrust::Untrusted
    };
    let summary = foundation
        .code_workspaces
        .set_trust(&command.payload.workspace_id, trust)
        .map_err(workspace_error)?;
    foundation
        .persistence
        .save_code_workspace(&summary)
        .await
        .map_err(database_error)?;
    foundation
        .audit
        .record(
            "code.workspace.trust",
            "success",
            if command.payload.grant {
                "warning"
            } else {
                "info"
            },
            Some(&summary.id),
            if command.payload.grant {
                Some("user granted file writes, process execution, Git reads, and preview access")
            } else {
                Some("workspace returned to read-only defaults")
            },
        )
        .await
        .map_err(database_error)?;
    Ok(response(
        &command.request_id,
        foundation.code_detail(&summary.id).await?,
    ))
}

#[tauri::command]
async fn agentic_super_app_query_code_file_tree(
    query: CodeFileTreeQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<CodeFileTree, ApiError> {
    foundation
        .code_workspaces
        .file_tree(&query.workspace_id, query.relative_path.as_deref())
        .map_err(workspace_error)
}

#[tauri::command]
async fn agentic_super_app_query_code_file(
    request: CodeReadFileRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<CodeDocument, ApiError> {
    let document = foundation
        .code_workspaces
        .read_file(&request.workspace_id, &request.relative_path)
        .map_err(workspace_error)?;
    foundation
        .persistence
        .save_code_document(
            &request.workspace_id,
            &agentic_super_app_protocol::CodeDocumentSummary {
                relative_path: document.relative_path.clone(),
                language: document.language.clone(),
                last_fingerprint: Some(document.fingerprint.clone()),
                last_opened_at_unix_ms: now_ms(),
            },
        )
        .await
        .map_err(database_error)?;
    Ok(document)
}

#[tauri::command]
async fn agentic_super_app_command_save_code_file(
    command: CommandEnvelope<CodeSaveFileRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeDocument>, ApiError> {
    validate_code_command(&command)?;
    let document = foundation
        .code_workspaces
        .save_file(
            &command.payload.workspace_id,
            &command.payload.relative_path,
            &command.payload.content,
            command.payload.expected_fingerprint.as_deref(),
        )
        .map_err(workspace_error)?;
    foundation
        .persistence
        .save_code_document(
            &command.payload.workspace_id,
            &agentic_super_app_protocol::CodeDocumentSummary {
                relative_path: document.relative_path.clone(),
                language: document.language.clone(),
                last_fingerprint: Some(document.fingerprint.clone()),
                last_opened_at_unix_ms: now_ms(),
            },
        )
        .await
        .map_err(database_error)?;
    foundation
        .audit
        .record(
            "code.file.save",
            "success",
            "info",
            Some(&command.payload.relative_path),
            Some("atomic save with optimistic fingerprint check"),
        )
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, document))
}

#[tauri::command]
async fn agentic_super_app_command_save_code_layout(
    command: CommandEnvelope<CodeSaveLayoutRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodePaneLayout>, ApiError> {
    validate_code_command(&command)?;
    if command.payload.workspace_id != command.payload.layout.workspace_id {
        return Err(validation_error("Layout and workspace IDs must match."));
    }
    validate_layout(&command.payload.layout)
        .map_err(|error| validation_error(format!("Invalid pane layout: {error}")))?;
    foundation
        .code_workspaces
        .summary(&command.payload.workspace_id)
        .map_err(workspace_error)?;
    foundation
        .persistence
        .save_code_layout(&command.payload.layout)
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, command.payload.layout))
}

#[tauri::command]
async fn agentic_super_app_query_code_git_status(
    request: CodeGitStatusRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<CodeGitStatus, ApiError> {
    foundation
        .code_workspaces
        .require(
            &request.workspace_id,
            agentic_super_app_protocol::CodeWorkspaceCapability::ReadGit,
        )
        .map_err(workspace_error)?;
    let root = foundation
        .code_workspaces
        .root_path(&request.workspace_id)
        .map_err(workspace_error)?;
    foundation
        .code_git
        .status(&request.workspace_id, &root)
        .map_err(git_error)
}

#[tauri::command]
async fn agentic_super_app_query_code_git_diff(
    request: CodeGitDiffRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<CodeGitDiff, ApiError> {
    foundation
        .code_workspaces
        .require(
            &request.workspace_id,
            agentic_super_app_protocol::CodeWorkspaceCapability::ReadGit,
        )
        .map_err(workspace_error)?;
    let root = foundation
        .code_workspaces
        .root_path(&request.workspace_id)
        .map_err(workspace_error)?;
    foundation
        .code_git
        .diff(
            &request.workspace_id,
            &root,
            request.relative_path.as_deref(),
        )
        .map_err(git_error)
}

#[tauri::command]
async fn agentic_super_app_command_start_code_terminal(
    command: CommandEnvelope<CodeTerminalStartRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
    channel: Channel<CodeTerminalEvent>,
) -> Result<ResponseEnvelope<CodeTerminalSummary>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            agentic_super_app_protocol::CodeWorkspaceCapability::ExecuteProcesses,
        )
        .map_err(workspace_error)?;
    if command.payload.kind == agentic_super_app_protocol::CodeTerminalKind::CodingAgent
        && command
            .payload
            .adapter_id
            .as_deref()
            .unwrap_or(CODEX_ADAPTER_ID)
            != CODEX_ADAPTER_ID
    {
        return Err(validation_error(
            "Only the configured Codex adapter is available in Code mode.",
        ));
    }
    let root = foundation
        .code_workspaces
        .root_path(&command.payload.workspace_id)
        .map_err(workspace_error)?;
    let persistence = foundation.persistence.clone();
    let sink: TerminalEventSink = Arc::new(move |event| {
        let _ = channel.send(event.clone());
        if matches!(
            event.kind,
            agentic_super_app_protocol::CodeTerminalEventKind::Exited
        ) {
            let persistence = persistence.clone();
            tauri::async_runtime::spawn(async move {
                let _ = persistence
                    .finish_code_terminal(
                        &event.terminal_id,
                        agentic_super_app_protocol::CodeTerminalState::Exited,
                        event.exit_code,
                    )
                    .await;
            });
        }
    });
    let summary = foundation
        .code_runtime
        .start(&command.payload, &root, sink)
        .map_err(runtime_error)?;
    foundation
        .persistence
        .save_code_terminal(&summary)
        .await
        .map_err(database_error)?;
    foundation
        .audit
        .record(
            "code.terminal.start",
            "success",
            "info",
            Some(&summary.id),
            Some(
                if summary.kind == agentic_super_app_protocol::CodeTerminalKind::CodingAgent {
                    "structured coding-agent adapter launch"
                } else {
                    "workspace-scoped PTY launch"
                },
            ),
        )
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, summary))
}

#[tauri::command]
async fn agentic_super_app_command_write_code_terminal(
    command: CommandEnvelope<CodeTerminalInputRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_runtime
        .write(&command.payload)
        .map_err(runtime_error)?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn agentic_super_app_command_resize_code_terminal(
    command: CommandEnvelope<CodeTerminalResizeRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_runtime
        .resize(&command.payload)
        .map_err(runtime_error)?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn agentic_super_app_command_stop_code_terminal(
    command: CommandEnvelope<CodeTerminalStopRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let stopped = foundation
        .code_runtime
        .stop(&command.payload)
        .map_err(runtime_error)?;
    if stopped {
        let _ = foundation
            .persistence
            .finish_code_terminal(
                &command.payload.terminal_id,
                agentic_super_app_protocol::CodeTerminalState::Interrupted,
                None,
            )
            .await;
    }
    Ok(response(&command.request_id, stopped))
}

#[tauri::command]
async fn agentic_super_app_command_open_code_preview(
    app: tauri::AppHandle,
    command: CommandEnvelope<CodePreviewRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodePreviewSummary>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            agentic_super_app_protocol::CodeWorkspaceCapability::OpenPreview,
        )
        .map_err(workspace_error)?;
    let url = validate_preview_url(&command.payload.url)?;
    let origin = url.origin().ascii_serialization();
    let label = format!("agentic-preview-{}", uuid::Uuid::now_v7());
    let allowed_origin = origin.clone();
    tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::utils::config::WebviewUrl::External(url.clone()),
    )
    .title("Local preview")
    .on_navigation(move |next| next.origin().ascii_serialization() == allowed_origin)
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build()
    .map_err(|error| {
        application_error(
            "preview_open_failed",
            error.to_string(),
            RetryClass::AfterUserAction,
        )
    })?;
    let preview = CodePreviewSummary {
        id: label,
        workspace_id: command.payload.workspace_id.clone(),
        url: url.to_string(),
        origin,
        state: CodePreviewState::Open,
    };
    foundation
        .persistence
        .save_code_preview(&preview, now_ms())
        .await
        .map_err(database_error)?;
    foundation
        .audit
        .record(
            "code.preview.open",
            "success",
            "info",
            Some(&preview.origin),
            Some("isolated auxiliary webview with same-origin navigation policy"),
        )
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, preview))
}

#[tauri::command]
async fn agentic_super_app_query_chat_sidebar(
    query: ChatSidebarQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ChatSidebarPage, ApiError> {
    foundation.chat.sidebar(&query).await.map_err(chat_error)
}

#[tauri::command]
async fn agentic_super_app_query_chat_conversation(
    conversation_id: String,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ChatConversationDetail, ApiError> {
    foundation
        .chat
        .detail(&conversation_id)
        .await
        .map_err(chat_error)
}

#[tauri::command]
async fn agentic_super_app_query_chat_events(
    query: ChatEventsQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<ChatEventEnvelope>, ApiError> {
    foundation
        .chat
        .events_since(
            &query.conversation_id,
            query.after_global_sequence,
            query.limit.unwrap_or(500),
        )
        .await
        .map_err(chat_error)
}

#[tauri::command]
async fn agentic_super_app_command_create_chat(
    command: CommandEnvelope<ChatCreateRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<ChatConversationDetail>, ApiError> {
    validate_chat_command(&command)?;
    let payload = foundation
        .chat
        .create(&command.payload, Some(&command.request_id))
        .await
        .map_err(chat_error)?;
    Ok(response(&command.request_id, payload))
}

#[tauri::command]
async fn agentic_super_app_command_update_chat(
    command: CommandEnvelope<ChatMetadataRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<ChatConversationDetail>, ApiError> {
    validate_chat_command(&command)?;
    let payload = foundation
        .chat
        .update_metadata(&command.payload)
        .await
        .map_err(chat_error)?;
    Ok(response(&command.request_id, payload))
}

#[tauri::command]
async fn agentic_super_app_command_delete_chat(
    command: CommandEnvelope<ChatDeleteRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_chat_command(&command)?;
    let paths = foundation
        .chat
        .delete_conversation(&command.payload.conversation_id)
        .await
        .map_err(chat_error)?;
    for path in paths {
        let _ = foundation.artifacts.remove_relative_path(&path);
    }
    foundation
        .audit
        .record(
            "chat.delete",
            "success",
            "info",
            Some(&command.payload.conversation_id),
            Some("conversation and owned attachments deleted"),
        )
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn agentic_super_app_command_save_chat_draft(
    command: CommandEnvelope<ChatDraftRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_chat_command(&command)?;
    foundation
        .chat
        .save_draft(&command.payload)
        .await
        .map_err(chat_error)?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn agentic_super_app_command_import_chat_attachments(
    command: CommandEnvelope<ChatAttachmentImportRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<Vec<agentic_super_app_protocol::ChatAttachmentSummary>>, ApiError> {
    validate_chat_command(&command)?;
    foundation
        .chat
        .detail(&command.payload.conversation_id)
        .await
        .map_err(chat_error)?;
    let paths = command
        .payload
        .paths
        .iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let imported = foundation
        .artifacts
        .import_paths(&paths)
        .map_err(artifact_error)?;
    let mut summaries = Vec::with_capacity(imported.len());
    for stored in imported {
        let summary = foundation
            .chat
            .register_attachment(
                &stored.summary,
                &relative_artifact_path(&stored, &foundation.artifacts),
            )
            .await
            .map_err(chat_error)?;
        summaries.push(summary);
    }
    if let Some(message_id) = command.payload.message_id {
        foundation
            .chat
            .attach_to_message(
                &command.payload.conversation_id,
                &message_id,
                &summaries
                    .iter()
                    .map(|item| item.id.clone())
                    .collect::<Vec<_>>(),
            )
            .await
            .map_err(chat_error)?;
    }
    Ok(response(&command.request_id, summaries))
}

#[tauri::command]
async fn agentic_super_app_command_delete_chat_attachment(
    command: CommandEnvelope<agentic_super_app_protocol::ChatDeleteAttachmentRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_chat_command(&command)?;
    let path = foundation
        .chat
        .remove_attachment(
            &command.payload.conversation_id,
            &command.payload.message_id,
            &command.payload.attachment_id,
        )
        .await
        .map_err(chat_error)?;
    if let Some(path) = path {
        let _ = foundation.artifacts.remove_relative_path(&path);
    }
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn agentic_super_app_command_start_chat_turn(
    command: CommandEnvelope<ChatSendRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<ChatConversationDetail>, ApiError> {
    validate_chat_command(&command)?;
    validate_send_request(&command.payload).map_err(|error| validation_error(error.to_string()))?;
    if command.payload.provider_account_id != AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID {
        return Err(validation_error("Unknown provider account."));
    }
    if let Some(existing) = foundation
        .chat
        .turn_for_command(&command.request_id)
        .await
        .map_err(chat_error)?
    {
        return Ok(response(
            &command.request_id,
            foundation
                .chat
                .detail(&existing.conversation_id)
                .await
                .map_err(chat_error)?,
        ));
    }
    let secret = foundation
        .persistence
        .provider_secret_ref()
        .await
        .map_err(database_error)?
        .ok_or_else(|| validation_error("Store an API key before starting a chat."))?;
    let (job, cancellation) = foundation
        .jobs
        .create("chat_turn")
        .await
        .map_err(database_error)?;
    let start = match foundation
        .chat
        .start_turn(&command.payload, Some(&job.id), Some(&command.request_id))
        .await
    {
        Ok(value) => value,
        Err(error) => {
            let _ = foundation
                .jobs
                .transition(
                    &job.id,
                    JobState::Failed,
                    Some("Chat turn was not started".to_owned()),
                    Some("chat_start_failed"),
                )
                .await;
            return Err(chat_error(error));
        }
    };
    if start.already_started {
        let _ = foundation
            .jobs
            .transition(
                &job.id,
                JobState::Cancelled,
                Some("Duplicate chat command acknowledged".to_owned()),
                Some("duplicate_command"),
            )
            .await;
        return Ok(response(
            &command.request_id,
            foundation
                .chat
                .detail(&command.payload.conversation_id)
                .await
                .map_err(chat_error)?,
        ));
    }
    foundation
        .jobs
        .transition(
            &job.id,
            JobState::Running,
            Some("Chat response started".to_owned()),
            None,
        )
        .await
        .map_err(database_error)?;
    foundation
        .chat_cancellations
        .lock()
        .map_err(|_| unavailable_error())?
        .insert(start.turn_id.clone(), cancellation.clone());
    let runtime = foundation.inner().clone();
    tauri::async_runtime::spawn(run_chat_turn(
        runtime,
        start,
        secret,
        command.payload.model.clone(),
        command.payload.reasoning_effort,
        cancellation,
    ));
    let detail = foundation
        .chat
        .detail(&command.payload.conversation_id)
        .await
        .map_err(chat_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_cancel_chat_turn(
    command: CommandEnvelope<ChatTurnRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_chat_command(&command)?;
    let cancellation = foundation
        .chat_cancellations
        .lock()
        .map_err(|_| unavailable_error())?
        .get(&command.payload.turn_id)
        .cloned();
    let Some(cancellation) = cancellation else {
        return Ok(response(&command.request_id, false));
    };
    if let Some(event) = foundation
        .chat
        .cancel_requested(&command.payload.conversation_id, &command.payload.turn_id)
        .await
        .map_err(chat_error)?
    {
        let _ = foundation.chat_events.send(event);
    }
    cancellation.cancel();
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn agentic_super_app_command_retry_chat_turn(
    command: CommandEnvelope<ChatTurnRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<ChatConversationDetail>, ApiError> {
    validate_chat_command(&command)?;
    if let Some(existing) = foundation
        .chat
        .turn_for_command(&command.request_id)
        .await
        .map_err(chat_error)?
    {
        return Ok(response(
            &command.request_id,
            foundation
                .chat
                .detail(&existing.conversation_id)
                .await
                .map_err(chat_error)?,
        ));
    }
    let account = foundation
        .persistence
        .provider_accounts()
        .await
        .map_err(database_error)?
        .into_iter()
        .find(|account| account.id == AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID)
        .ok_or_else(|| validation_error("Provider account is unavailable."))?;
    let model = command
        .payload
        .model
        .clone()
        .or(account.default_model)
        .ok_or_else(|| validation_error("Select a model before retrying."))?;
    let effort = command
        .payload
        .reasoning_effort
        .unwrap_or(ChatReasoningEffort::Auto);
    let request = ChatSendRequest {
        conversation_id: command.payload.conversation_id.clone(),
        branch_id: String::new(),
        text: String::new(),
        attachment_ids: Vec::new(),
        provider_account_id: AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID.to_owned(),
        model,
        reasoning_effort: effort,
    };
    let secret = foundation
        .persistence
        .provider_secret_ref()
        .await
        .map_err(database_error)?
        .ok_or_else(|| validation_error("Store an API key before retrying a chat."))?;
    let (job, cancellation) = foundation
        .jobs
        .create("chat_turn_retry")
        .await
        .map_err(database_error)?;
    let start = foundation
        .chat
        .retry_turn(
            &command.payload.conversation_id,
            &command.payload.turn_id,
            &request,
            Some(&job.id),
            Some(&command.request_id),
        )
        .await
        .map_err(chat_error)?;
    if start.already_started {
        let _ = foundation
            .jobs
            .transition(
                &job.id,
                JobState::Cancelled,
                Some("Duplicate chat retry acknowledged".to_owned()),
                Some("duplicate_command"),
            )
            .await;
        return Ok(response(
            &command.request_id,
            foundation
                .chat
                .detail(&command.payload.conversation_id)
                .await
                .map_err(chat_error)?,
        ));
    }
    foundation
        .jobs
        .transition(
            &job.id,
            JobState::Running,
            Some("Chat retry started".to_owned()),
            None,
        )
        .await
        .map_err(database_error)?;
    foundation
        .chat_cancellations
        .lock()
        .map_err(|_| unavailable_error())?
        .insert(start.turn_id.clone(), cancellation.clone());
    let runtime = foundation.inner().clone();
    tauri::async_runtime::spawn(run_chat_turn(
        runtime,
        start,
        secret,
        request.model,
        request.reasoning_effort,
        cancellation,
    ));
    Ok(response(
        &command.request_id,
        foundation
            .chat
            .detail(&command.payload.conversation_id)
            .await
            .map_err(chat_error)?,
    ))
}

#[tauri::command]
async fn agentic_super_app_command_edit_chat_message(
    command: CommandEnvelope<ChatEditRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<ChatConversationDetail>, ApiError> {
    validate_chat_command(&command)?;
    if command.payload.text.trim().is_empty() {
        return Err(validation_error("Edited message cannot be empty."));
    }
    if let Some(existing) = foundation
        .chat
        .turn_for_command(&command.request_id)
        .await
        .map_err(chat_error)?
    {
        return Ok(response(
            &command.request_id,
            foundation
                .chat
                .detail(&existing.conversation_id)
                .await
                .map_err(chat_error)?,
        ));
    }
    let secret = foundation
        .persistence
        .provider_secret_ref()
        .await
        .map_err(database_error)?
        .ok_or_else(|| validation_error("Store an API key before editing a chat."))?;
    let (job, cancellation) = foundation
        .jobs
        .create("chat_turn_edit")
        .await
        .map_err(database_error)?;
    let start = foundation
        .chat
        .edit_message(&command.payload, Some(&job.id), Some(&command.request_id))
        .await
        .map_err(chat_error)?;
    if start.already_started {
        let _ = foundation
            .jobs
            .transition(
                &job.id,
                JobState::Cancelled,
                Some("Duplicate chat edit acknowledged".to_owned()),
                Some("duplicate_command"),
            )
            .await;
        return Ok(response(
            &command.request_id,
            foundation
                .chat
                .detail(&command.payload.conversation_id)
                .await
                .map_err(chat_error)?,
        ));
    }
    foundation
        .jobs
        .transition(
            &job.id,
            JobState::Running,
            Some("Edited chat response started".to_owned()),
            None,
        )
        .await
        .map_err(database_error)?;
    foundation
        .chat_cancellations
        .lock()
        .map_err(|_| unavailable_error())?
        .insert(start.turn_id.clone(), cancellation.clone());
    let runtime = foundation.inner().clone();
    tauri::async_runtime::spawn(run_chat_turn(
        runtime,
        start,
        secret,
        command.payload.model.clone(),
        command.payload.reasoning_effort,
        cancellation,
    ));
    Ok(response(
        &command.request_id,
        foundation
            .chat
            .detail(&command.payload.conversation_id)
            .await
            .map_err(chat_error)?,
    ))
}

#[tauri::command]
async fn agentic_super_app_command_branch_chat(
    command: CommandEnvelope<ChatBranchRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<ChatConversationDetail>, ApiError> {
    validate_chat_command(&command)?;
    let detail = foundation
        .chat
        .branch_after(
            &command.payload.conversation_id,
            &command.payload.message_id,
            Some(&command.request_id),
        )
        .await
        .map_err(chat_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_export_chat(
    command: CommandEnvelope<ChatExportRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_chat_command(&command)?;
    let detail = foundation
        .chat
        .detail(&command.payload.conversation_id)
        .await
        .map_err(chat_error)?;
    if detail.active_branch_id != command.payload.branch_id {
        return Err(validation_error(
            "Export the active branch or switch branches first.",
        ));
    }
    let attachments = foundation
        .chat
        .attachments_for_branch(&command.payload.conversation_id, &command.payload.branch_id)
        .await
        .map_err(chat_error)?;
    let manifest = serde_json::json!({ "schema_version": 1, "conversation": detail, "attachments": attachments.iter().map(|item| &item.summary).collect::<Vec<_>>() });
    let mut files = Vec::with_capacity(attachments.len());
    for item in &attachments {
        files.push((
            item.summary.display_name.clone(),
            foundation
                .artifacts
                .resolve_relative_path(&item.relative_path)
                .map_err(artifact_error)?,
        ));
    }
    foundation
        .artifacts
        .write_export(
            &PathBuf::from(&command.payload.destination),
            &serde_json::to_string_pretty(&manifest)
                .map_err(|_| validation_error("Chat export could not be serialized."))?,
            &files,
        )
        .map_err(artifact_error)?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn agentic_super_app_stream_chat_events(
    request: ChatStreamRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
    channel: Channel<ChatEventEnvelope>,
) -> Result<(), ApiError> {
    let mut receiver = foundation.chat_events.subscribe();
    let mut cursor = request.after_global_sequence;
    if let Ok(backlog) = foundation.chat.all_events_since(cursor).await {
        for event in backlog {
            cursor = cursor.max(event.global_sequence);
            if channel.send(event).is_err() {
                return Ok(());
            }
        }
    }
    while let Ok(event) = receiver.recv().await {
        if event.global_sequence > cursor {
            cursor = event.global_sequence;
            if channel.send(event).is_err() {
                break;
            }
        }
    }
    Ok(())
}

async fn run_chat_turn(
    foundation: AgenticSuperAppFoundation,
    start: agentic_super_app_persistence::chat::AgenticSuperAppChatTurnStart,
    secret: String,
    model: String,
    reasoning_effort: ChatReasoningEffort,
    cancellation: CancellationToken,
) {
    let request = match build_chat_model_request(
        &foundation,
        &start.conversation_id,
        &model,
        reasoning_effort,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            let code = if error.starts_with("context_overflow:") {
                "context_overflow"
            } else {
                "attachment_read_failed"
            };
            let message = error
                .strip_prefix("context_overflow:")
                .unwrap_or(&error)
                .trim()
                .to_owned();
            finish_chat_turn_with_error(&foundation, &start, code, message).await;
            if let Some(job_id) = start.job_id.as_deref() {
                let _ = foundation
                    .jobs
                    .transition(
                        job_id,
                        JobState::Failed,
                        Some("Chat response was not sent".to_owned()),
                        Some(code),
                    )
                    .await;
            }
            let _ = foundation
                .chat_cancellations
                .lock()
                .map(|mut values| values.remove(&start.turn_id));
            return;
        }
    };
    let (sender, mut receiver) = mpsc::unbounded_channel::<ChatProviderStreamEvent>();
    let callback = Arc::new(move |event: ChatProviderStreamEvent| {
        let _ = sender.send(event);
    });
    let provider = foundation.provider.clone();
    let provider_future =
        provider.stream_chat_turn(&secret, request, cancellation.clone(), callback);
    let chat = foundation.chat.clone();
    let events = foundation.chat_events.clone();
    let conversation_id = start.conversation_id.clone();
    let turn_id = start.turn_id.clone();
    let consumer = async move {
        while let Some(event) = receiver.recv().await {
            if let Some(envelope) = chat
                .apply_provider_event(&conversation_id, &turn_id, &event)
                .await
                .map_err(|error| error.to_string())?
            {
                let _ = events.send(envelope);
            }
        }
        Ok::<(), String>(())
    };
    let (provider_result, consumer_result) = tokio::join!(provider_future, consumer);
    let job_id = start.job_id.as_deref();
    let terminal = match provider_result {
        Ok(()) if consumer_result.is_ok() => {
            if let Ok(Some(event)) = foundation
                .chat
                .apply_provider_event(
                    &start.conversation_id,
                    &start.turn_id,
                    &ChatProviderStreamEvent {
                        provider_sequence: -1,
                        kind: agentic_super_app_protocol::ChatProviderStreamEventKind::Completed,
                        text: None,
                        input_tokens: None,
                        output_tokens: None,
                        error_code: None,
                    },
                )
                .await
            {
                let _ = foundation.chat_events.send(event);
            }
            (JobState::Completed, None)
        }
        Err(AgenticSuperAppProviderError::Cancelled) => {
            if let Ok(Some(event)) = foundation
                .chat
                .cancelled(&start.conversation_id, &start.turn_id)
                .await
            {
                let _ = foundation.chat_events.send(event);
            }
            (JobState::Cancelled, None)
        }
        Err(error) => {
            finish_chat_turn_with_error(
                &foundation,
                &start,
                provider_error_code(&error),
                "The provider could not complete this response.".to_owned(),
            )
            .await;
            (JobState::Failed, Some(provider_error_code(&error)))
        }
        Ok(()) => {
            finish_chat_turn_with_error(
                &foundation,
                &start,
                "chat_persistence_failed",
                "The response could not be persisted.".to_owned(),
            )
            .await;
            (JobState::Failed, Some("chat_persistence_failed"))
        }
    };
    if let Some(job_id) = job_id {
        let _ = foundation
            .jobs
            .transition(
                job_id,
                terminal.0,
                Some("Chat response finished".to_owned()),
                terminal.1,
            )
            .await;
    }
    let _ = foundation
        .chat_cancellations
        .lock()
        .map(|mut values| values.remove(&start.turn_id));
}

async fn finish_chat_turn_with_error(
    foundation: &AgenticSuperAppFoundation,
    start: &agentic_super_app_persistence::chat::AgenticSuperAppChatTurnStart,
    code: &str,
    message: String,
) {
    if let Ok(Some(event)) = foundation
        .chat
        .apply_provider_event(
            &start.conversation_id,
            &start.turn_id,
            &ChatProviderStreamEvent {
                provider_sequence: -1,
                kind: agentic_super_app_protocol::ChatProviderStreamEventKind::Failed,
                text: Some(message),
                input_tokens: None,
                output_tokens: None,
                error_code: Some(code.to_owned()),
            },
        )
        .await
    {
        let _ = foundation.chat_events.send(event);
    }
}

async fn build_chat_model_request(
    foundation: &AgenticSuperAppFoundation,
    conversation_id: &str,
    model: &str,
    reasoning_effort: ChatReasoningEffort,
) -> Result<ChatModelTurnRequest, String> {
    let detail = foundation
        .chat
        .detail(conversation_id)
        .await
        .map_err(|error| error.to_string())?;
    const CHAT_CONTEXT_BUDGET_TOKENS: u64 = 128_000;
    let estimated_tokens = estimate_context_tokens(&detail.messages);
    if estimated_tokens > CHAT_CONTEXT_BUDGET_TOKENS {
        return Err(format!("context_overflow:Context is approximately {estimated_tokens} tokens, above the 128k policy. Remove an attachment or start a new branch before sending."));
    }
    let stored = foundation
        .chat
        .attachments_for_branch(conversation_id, &detail.active_branch_id)
        .await
        .map_err(|error| error.to_string())?;
    let mut messages = Vec::with_capacity(detail.messages.len());
    for message in detail.messages {
        let mut parts = Vec::new();
        for part in message.parts {
            match part {
                ChatMessagePart::Text { text } if !text.is_empty() => {
                    parts.push(ChatProviderPart {
                        kind: "text".to_owned(),
                        text: Some(text),
                        data_url: None,
                        file_name: None,
                        mime_type: None,
                    })
                }
                ChatMessagePart::Attachment { attachment }
                | ChatMessagePart::Image { attachment } => {
                    let record = stored
                        .iter()
                        .find(|item| item.summary.id == attachment.id)
                        .ok_or_else(|| "The attached file is no longer available.".to_owned())?;
                    let path = foundation
                        .artifacts
                        .resolve_relative_path(&record.relative_path)
                        .map_err(|error| error.to_string())?;
                    let bytes = std::fs::read(path)
                        .map_err(|_| "The attached file could not be read.".to_owned())?;
                    let kind = if attachment.mime_type.starts_with("image/") {
                        "image"
                    } else {
                        "file"
                    };
                    parts.push(ChatProviderPart {
                        kind: kind.to_owned(),
                        text: None,
                        data_url: Some(format!(
                            "data:{};base64,{}",
                            attachment.mime_type,
                            STANDARD.encode(bytes)
                        )),
                        file_name: Some(attachment.display_name),
                        mime_type: Some(attachment.mime_type),
                    });
                }
                _ => {}
            }
        }
        messages.push(ChatProviderMessage {
            role: message.role,
            parts,
        });
    }
    Ok(ChatModelTurnRequest {
        model: model.to_owned(),
        reasoning_effort,
        messages,
    })
}

fn validate_chat_command<T>(command: &CommandEnvelope<T>) -> Result<(), ApiError> {
    if command.request_id.trim().is_empty() {
        return Err(validation_error("A request ID is required."));
    }
    if command.protocol.major != AGENTIC_SUPER_APP_PROTOCOL_VERSION {
        return Err(application_error(
            "protocol_mismatch",
            "This renderer and host use incompatible protocol versions.",
            RetryClass::AfterUserAction,
        ));
    }
    Ok(())
}

fn validate_code_command<T>(command: &CommandEnvelope<T>) -> Result<(), ApiError> {
    validate_chat_command(command)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn validate_preview_url(value: &str) -> Result<url::Url, ApiError> {
    let url = url::Url::parse(value.trim())
        .map_err(|_| validation_error("Preview URL must be a valid HTTP or HTTPS URL."))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(validation_error(
            "Preview URLs cannot contain embedded credentials.",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| validation_error("Preview URL must include a host."))?;
    match url.scheme() {
        "http" if matches!(host, "localhost" | "127.0.0.1" | "::1") => Ok(url),
        "https" => Ok(url),
        _ => Err(validation_error(
            "Preview allows localhost HTTP or explicitly approved HTTPS origins only.",
        )),
    }
}

fn workspace_error(error: AgenticSuperAppWorkspaceError) -> ApiError {
    let (code, message, retry) = match error {
        AgenticSuperAppWorkspaceError::InvalidRoot(_) => (
            "workspace_invalid_root",
            "The selected workspace folder could not be opened.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppWorkspaceError::NotFound => (
            "workspace_not_found",
            "The workspace is no longer available.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppWorkspaceError::Untrusted
        | AgenticSuperAppWorkspaceError::CapabilityDenied(_) => (
            "workspace_trust_required",
            "Trust this workspace before using this capability.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppWorkspaceError::InvalidPath(_) => (
            "workspace_path_denied",
            "That path is outside the approved workspace policy.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppWorkspaceError::FileTooLarge => (
            "code_file_too_large",
            "The file is too large for the inline editor.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppWorkspaceError::BinaryFile => (
            "code_binary_file",
            "Binary files cannot be edited in the inline editor.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppWorkspaceError::FileConflict => (
            "code_file_conflict",
            "The file changed on disk. Reload it before saving.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppWorkspaceError::SymlinkNotAllowed => (
            "code_symlink_denied",
            "Symbolic links are not opened or edited through Code mode.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppWorkspaceError::Io(_) => (
            "workspace_io_failed",
            "The workspace filesystem operation failed.",
            RetryClass::Safe,
        ),
    };
    application_error(code, message, retry)
}

fn runtime_error(error: AgenticSuperAppCodeRuntimeError) -> ApiError {
    let (code, message) = match error {
        AgenticSuperAppCodeRuntimeError::InvalidDimensions => (
            "terminal_invalid_dimensions",
            "The terminal size is outside the supported range.",
        ),
        AgenticSuperAppCodeRuntimeError::UnsupportedAdapter => (
            "code_adapter_unavailable",
            "The requested coding-agent adapter is unavailable.",
        ),
        AgenticSuperAppCodeRuntimeError::TerminalNotFound => (
            "terminal_not_found",
            "The terminal session is no longer available.",
        ),
        AgenticSuperAppCodeRuntimeError::Operation(_) => (
            "terminal_operation_failed",
            "The terminal operation could not be completed.",
        ),
    };
    application_error(code, message, RetryClass::AfterUserAction)
}

fn git_error(error: AgenticSuperAppGitError) -> ApiError {
    match error {
        AgenticSuperAppGitError::NotRepository => application_error(
            "git_not_repository",
            "The workspace is not a Git repository.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppGitError::InvalidPath(_) => application_error(
            "git_path_denied",
            "The requested diff path is outside the workspace policy.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppGitError::Git(_) => application_error(
            "git_read_failed",
            "Git status or diff could not be read.",
            RetryClass::Safe,
        ),
        AgenticSuperAppGitError::Io(_) => application_error(
            "git_io_failed",
            "The Git filesystem operation could not be completed.",
            RetryClass::Safe,
        ),
        AgenticSuperAppGitError::InvalidWorktreeName => application_error(
            "git_worktree_name_invalid",
            "The managed worktree name is invalid.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppGitError::WorktreeOutsideManagedRoot => application_error(
            "git_worktree_path_denied",
            "The managed worktree path is outside the orchestration directory.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppGitError::WorktreeDirty(_) => application_error(
            "git_worktree_dirty",
            "The worktree has uncommitted files. Review it before cleanup.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppGitError::WorktreeLocked => application_error(
            "git_worktree_locked",
            "The worktree is still locked by its worker lease.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppGitError::MissingHead => application_error(
            "git_missing_head",
            "The repository has no commit to use as an orchestration base.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppGitError::MergeConflict(_) => application_error(
            "git_orchestration_conflict",
            "Dependency checkpoints conflict and were not integrated.",
            RetryClass::AfterUserAction,
        ),
    }
}

fn orchestration_error(error: AgenticSuperAppCodeOrchestrationError) -> ApiError {
    match error {
        AgenticSuperAppCodeOrchestrationError::Database(_) => application_error(
            "code_orchestration_database_failed",
            "The durable Code run state could not be saved.",
            RetryClass::Safe,
        ),
        AgenticSuperAppCodeOrchestrationError::Workspace(error) => workspace_error(error),
        AgenticSuperAppCodeOrchestrationError::Git(error) => git_error(error),
        AgenticSuperAppCodeOrchestrationError::Domain(error) => validation_error(error.to_string()),
        AgenticSuperAppCodeOrchestrationError::Json(_) => application_error(
            "code_orchestration_invalid_data",
            "The orchestration payload was invalid.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppCodeOrchestrationError::Io(_) => application_error(
            "code_orchestration_io_failed",
            "The orchestration filesystem operation failed.",
            RetryClass::Safe,
        ),
        AgenticSuperAppCodeOrchestrationError::NotFound => application_error(
            "code_orchestration_not_found",
            "The requested Code run no longer exists.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppCodeOrchestrationError::InvalidState(message) => validation_error(message),
        AgenticSuperAppCodeOrchestrationError::WorkerUnavailable(_) => application_error(
            "code_worker_unavailable",
            "The configured coding agent is not available on this host.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppCodeOrchestrationError::WorkerFailed(_) => application_error(
            "code_worker_failed",
            "The coding-agent worker failed. Inspect the run and retry the task if appropriate.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppCodeOrchestrationError::InvalidWorkerEvent => application_error(
            "code_worker_event_rejected",
            "A worker event failed the orchestration authenticity check.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppCodeOrchestrationError::InvalidCleanupConfirmation => {
            validation_error("Type the exact cleanup confirmation shown for this worktree.")
        }
    }
}

fn response<T>(request_id: &str, payload: T) -> ResponseEnvelope<T> {
    ResponseEnvelope {
        protocol: current_protocol_version(),
        request_id: request_id.to_owned(),
        payload,
    }
}
fn relative_artifact_path(
    stored: &AgenticSuperAppStoredAttachment,
    artifacts: &AgenticSuperAppArtifactStore,
) -> String {
    stored
        .absolute_path
        .strip_prefix(artifacts.root())
        .unwrap_or(&stored.absolute_path)
        .to_string_lossy()
        .replace('\\', "/")
}
fn provider_error_code(error: &AgenticSuperAppProviderError) -> &'static str {
    match error {
        AgenticSuperAppProviderError::CredentialsUnavailable => "provider_not_configured",
        AgenticSuperAppProviderError::Request(_) => "provider_request_failed",
        AgenticSuperAppProviderError::InvalidResponse => "provider_invalid_response",
        AgenticSuperAppProviderError::Cancelled => "cancelled",
    }
}
fn artifact_error(error: AgenticSuperAppArtifactError) -> ApiError {
    let (code, message) = match error {
        AgenticSuperAppArtifactError::NotAFile => {
            ("attachment_not_a_file", "Choose a regular file.")
        }
        AgenticSuperAppArtifactError::UnsupportedType => (
            "attachment_type_denied",
            "Only PDF, PNG, JPEG, WebP, text, and Markdown files are supported.",
        ),
        AgenticSuperAppArtifactError::TooLarge => (
            "attachment_too_large",
            "The attachment exceeds the Chat size limit.",
        ),
        AgenticSuperAppArtifactError::InvalidText => (
            "attachment_invalid_text",
            "Text attachments must be valid UTF-8 without binary data.",
        ),
        AgenticSuperAppArtifactError::InvalidContent => (
            "attachment_invalid_content",
            "The file content does not match its detected type.",
        ),
        AgenticSuperAppArtifactError::Storage => (
            "attachment_storage_failed",
            "The attachment could not be stored safely.",
        ),
        AgenticSuperAppArtifactError::Export => (
            "export_failed",
            "The conversation export could not be written.",
        ),
    };
    application_error(code, message, RetryClass::AfterUserAction)
}
fn chat_error(error: AgenticSuperAppChatStoreError) -> ApiError {
    match error {
        AgenticSuperAppChatStoreError::NotFound => application_error(
            "chat_not_found",
            "The conversation or message no longer exists.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppChatStoreError::ActiveTurn => application_error(
            "turn_active",
            "Stop the active response before starting another one.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppChatStoreError::InvalidInput(message) => {
            application_error("chat_invalid_input", message, RetryClass::AfterUserAction)
        }
        AgenticSuperAppChatStoreError::Inconsistent => application_error(
            "chat_inconsistent",
            "Stored conversation data is inconsistent.",
            RetryClass::Safe,
        ),
        AgenticSuperAppChatStoreError::Database(error) => database_error(error),
        AgenticSuperAppChatStoreError::Serialization(_) => application_error(
            "chat_serialization_failed",
            "Conversation data could not be serialized.",
            RetryClass::Safe,
        ),
    }
}

#[tauri::command]
async fn agentic_super_app_command_configure_openai_provider(
    model: String,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    let model = model.trim();
    if model.is_empty() {
        return Err(validation_error("A model ID is required."));
    }
    let secret_ref = foundation
        .persistence
        .provider_secret_ref()
        .await
        .map_err(database_error)?;
    foundation
        .persistence
        .configure_provider(Some(model), secret_ref.as_deref())
        .await
        .map_err(database_error)?;
    foundation
        .audit
        .record(
            "provider.configure",
            "success",
            "info",
            Some(AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID),
            Some("model updated"),
        )
        .await
        .map_err(database_error)
}
#[tauri::command]
async fn agentic_super_app_command_set_openai_secret(
    secret: String,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    if secret.trim().is_empty() {
        return Err(validation_error("An API key is required."));
    }
    let previous = foundation
        .persistence
        .provider_secret_ref()
        .await
        .map_err(database_error)?;
    let reference = foundation.secrets.put(&secret).map_err(secret_error)?;
    let accounts = foundation
        .persistence
        .provider_accounts()
        .await
        .map_err(database_error)?;
    let model = accounts
        .first()
        .and_then(|account| account.default_model.as_deref());
    foundation
        .persistence
        .configure_provider(model, Some(&reference))
        .await
        .map_err(database_error)?;
    if let Some(previous) = previous {
        let _ = foundation.secrets.delete(&previous);
    }
    foundation
        .audit
        .record(
            "provider.secret.store",
            "success",
            "info",
            Some(AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID),
            Some("secret handle updated"),
        )
        .await
        .map_err(database_error)
}
#[tauri::command]
async fn agentic_super_app_command_validate_openai_provider(
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    let secret = foundation
        .persistence
        .provider_secret_ref()
        .await
        .map_err(database_error)?
        .ok_or_else(|| validation_error("Store an API key before validation."))?;
    foundation
        .provider
        .validate_credentials(&secret)
        .await
        .map_err(provider_error)?;
    foundation
        .audit
        .record(
            "provider.validate",
            "success",
            "info",
            Some(AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID),
            None,
        )
        .await
        .map_err(database_error)
}
#[tauri::command]
async fn agentic_super_app_command_start_provider_diagnostic(
    request: ProviderDiagnosticRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<String, ApiError> {
    if request.provider_account_id != AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID {
        return Err(validation_error("Unknown provider account."));
    }
    if request.model.trim().is_empty() {
        return Err(validation_error(
            "Select a model before starting a billable diagnostic.",
        ));
    }
    if request.prompt.trim().is_empty() {
        return Err(validation_error("A diagnostic prompt is required."));
    }
    let secret = foundation
        .persistence
        .provider_secret_ref()
        .await
        .map_err(database_error)?
        .ok_or_else(|| validation_error("Store an API key before starting a diagnostic."))?;
    let (job, cancellation) = foundation
        .jobs
        .create("provider_diagnostic")
        .await
        .map_err(database_error)?;
    foundation
        .jobs
        .transition(
            &job.id,
            JobState::Running,
            Some("Provider stream started".to_owned()),
            None,
        )
        .await
        .map_err(database_error)?;
    let provider = foundation.provider.clone();
    let jobs = foundation.jobs.clone();
    let audit = foundation.audit.clone();
    let job_id = job.id.clone();
    tauri::async_runtime::spawn(async move {
        let emit_jobs = jobs.clone();
        let emit_job_id = job_id.clone();
        let callback = Arc::new(move |kind, message, delta| {
            emit_jobs.emit(kind, Some(emit_job_id.clone()), message, delta)
        });
        match provider
            .stream_diagnostic(&secret, request, cancellation, callback)
            .await
        {
            Ok(usage) => {
                let _ = jobs
                    .transition(
                        &job_id,
                        JobState::Completed,
                        Some("Provider stream completed".to_owned()),
                        None,
                    )
                    .await;
                let _ = audit
                    .record(
                        "provider.diagnostic",
                        "success",
                        "info",
                        Some(&job_id),
                        Some(&format!(
                            "usage input={:?} output={:?}",
                            usage.input_tokens, usage.output_tokens
                        )),
                    )
                    .await;
            }
            Err(AgenticSuperAppProviderError::Cancelled) => {
                let _ = jobs
                    .transition(
                        &job_id,
                        JobState::Cancelled,
                        Some("Provider stream cancelled".to_owned()),
                        None,
                    )
                    .await;
                let _ = audit
                    .record(
                        "provider.diagnostic",
                        "cancelled",
                        "info",
                        Some(&job_id),
                        None,
                    )
                    .await;
            }
            Err(_) => {
                let _ = jobs
                    .transition(
                        &job_id,
                        JobState::Failed,
                        Some("Provider stream failed".to_owned()),
                        Some("provider_request_failed"),
                    )
                    .await;
                let _ = audit
                    .record(
                        "provider.diagnostic",
                        "failed",
                        "warning",
                        Some(&job_id),
                        Some("provider error redacted"),
                    )
                    .await;
            }
        }
    });
    Ok(job.id)
}
#[tauri::command]
async fn agentic_super_app_command_cancel_job(
    job_id: String,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<bool, ApiError> {
    Ok(foundation.jobs.cancel(&job_id))
}
#[tauri::command]
fn agentic_super_app_stream_shared_events(
    foundation: State<'_, AgenticSuperAppFoundation>,
    channel: Channel<SharedEventEnvelope>,
) {
    let mut receiver = foundation.jobs.subscribe();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = receiver.recv().await {
            let _ = channel.send(event);
        }
    });
}
#[tauri::command]
async fn agentic_super_app_command_send_test_notification(
    app: tauri::AppHandle,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    let item = foundation
        .notifications
        .create(
            "Diagnostics notification",
            "Shared notification delivery is available.",
            "info",
        )
        .await
        .map_err(database_error)?;
    let _ = app
        .notification()
        .builder()
        .title(&item.title)
        .body(&item.body)
        .show();
    Ok(())
}
#[tauri::command]
async fn agentic_super_app_command_prepare_restart_recovery(
    app: tauri::AppHandle,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    let (job, _) = foundation
        .jobs
        .create("restart_recovery")
        .await
        .map_err(database_error)?;
    foundation
        .jobs
        .transition(
            &job.id,
            JobState::Running,
            Some("Restart recovery checkpoint created".to_owned()),
            None,
        )
        .await
        .map_err(database_error)?;
    foundation
        .jobs
        .checkpoint(&job.id, 1, "Diagnostics requested restart recovery")
        .await
        .map_err(database_error)?;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        app.request_restart();
    });
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            let database_path = app_data_dir.join("agentic-super-app.sqlite3");
            let artifact_root = app_data_dir.join("artifacts");
            let orchestration_root = app_data_dir.join("orchestration");
            let foundation = tauri::async_runtime::block_on(AgenticSuperAppFoundation::open(
                database_path,
                artifact_root,
                orchestration_root,
            ))
            .map_err(Box::<dyn std::error::Error>::from)?;
            app.manage(AgenticSuperAppShellState::default());
            app.manage(foundation);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            agentic_super_app_query_bootstrap,
            agentic_super_app_command_set_active_mode,
            agentic_super_app_query_build_information,
            agentic_super_app_query_diagnostic_snapshot,
            agentic_super_app_query_code_snapshot,
            agentic_super_app_query_code_workspace,
            agentic_super_app_query_code_runs,
            agentic_super_app_query_code_run,
            agentic_super_app_query_code_orchestration_events,
            agentic_super_app_stream_code_orchestration_events,
            agentic_super_app_command_open_code_workspace,
            agentic_super_app_command_trust_code_workspace,
            agentic_super_app_command_create_code_run,
            agentic_super_app_command_update_code_run,
            agentic_super_app_command_create_code_task,
            agentic_super_app_command_update_code_task,
            agentic_super_app_command_delete_code_task,
            agentic_super_app_command_propose_code_dag,
            agentic_super_app_command_accept_code_dag,
            agentic_super_app_command_start_code_run,
            agentic_super_app_command_pause_code_run,
            agentic_super_app_command_cancel_code_run,
            agentic_super_app_command_answer_code_question,
            agentic_super_app_command_retry_code_task,
            agentic_super_app_command_review_code_checkpoint,
            agentic_super_app_query_code_cleanup_preview,
            agentic_super_app_query_code_checkpoint_diff,
            agentic_super_app_command_confirm_code_cleanup,
            agentic_super_app_query_code_file_tree,
            agentic_super_app_query_code_file,
            agentic_super_app_command_save_code_file,
            agentic_super_app_command_save_code_layout,
            agentic_super_app_query_code_git_status,
            agentic_super_app_query_code_git_diff,
            agentic_super_app_command_start_code_terminal,
            agentic_super_app_command_write_code_terminal,
            agentic_super_app_command_resize_code_terminal,
            agentic_super_app_command_stop_code_terminal,
            agentic_super_app_command_open_code_preview,
            agentic_super_app_query_chat_sidebar,
            agentic_super_app_query_chat_conversation,
            agentic_super_app_query_chat_events,
            agentic_super_app_command_create_chat,
            agentic_super_app_command_update_chat,
            agentic_super_app_command_delete_chat,
            agentic_super_app_command_save_chat_draft,
            agentic_super_app_command_import_chat_attachments,
            agentic_super_app_command_delete_chat_attachment,
            agentic_super_app_command_start_chat_turn,
            agentic_super_app_command_cancel_chat_turn,
            agentic_super_app_command_retry_chat_turn,
            agentic_super_app_command_edit_chat_message,
            agentic_super_app_command_branch_chat,
            agentic_super_app_command_export_chat,
            agentic_super_app_stream_chat_events,
            agentic_super_app_command_configure_openai_provider,
            agentic_super_app_command_set_openai_secret,
            agentic_super_app_command_validate_openai_provider,
            agentic_super_app_command_start_provider_diagnostic,
            agentic_super_app_command_cancel_job,
            agentic_super_app_stream_shared_events,
            agentic_super_app_command_send_test_notification,
            agentic_super_app_command_prepare_restart_recovery
        ])
        .run(tauri::generate_context!())
        .expect("error while running Agentic Super App");
}
fn application_error(code: &str, message: impl Into<String>, retry: RetryClass) -> ApiError {
    ApiError {
        code: code.to_owned(),
        message: message.into(),
        retry,
        recovery_action: None,
        diagnostic_id: None,
        redacted_context: None,
    }
}
fn validation_error(message: impl Into<String>) -> ApiError {
    application_error("validation_failed", message, RetryClass::AfterUserAction)
}
fn database_error(error: sqlx::Error) -> ApiError {
    application_error(
        "persistence_unavailable",
        error.to_string(),
        RetryClass::Safe,
    )
}
fn secret_error(_: agentic_super_app_secret_store::AgenticSuperAppSecretStoreError) -> ApiError {
    application_error(
        "secret_store_unavailable",
        "The operating system credential store is unavailable.",
        RetryClass::AfterUserAction,
    )
}
fn provider_error(_: AgenticSuperAppProviderError) -> ApiError {
    application_error(
        "provider_validation_failed",
        "Provider validation failed. Check the selected account and API key.",
        RetryClass::AfterUserAction,
    )
}
fn unavailable_error() -> ApiError {
    application_error(
        "state_unavailable",
        "Application state is unavailable.",
        RetryClass::Safe,
    )
}
