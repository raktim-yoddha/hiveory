#![allow(clippy::result_large_err)]

mod release;

use agentic_super_app_agent_runtime::AgenticSuperAppAgentRuntime;
use agentic_super_app_artifact_store::{
    AgenticSuperAppArtifactError, AgenticSuperAppArtifactStore, AgenticSuperAppStoredAttachment,
};
use agentic_super_app_chat_domain::{estimate_context_tokens, validate_send_request};
use agentic_super_app_code_domain::{default_layout, validate_layout};
use agentic_super_app_code_orchestration::{
    AgenticSuperAppCodeOrchestration, AgenticSuperAppCodeOrchestrationError,
};
use agentic_super_app_code_runtime::{
    stream_cli_chat_turn, AgenticSuperAppCodeRuntime, AgenticSuperAppCodeRuntimeError,
    TerminalEventSink,
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
use agentic_super_app_plugin_runtime::{
    AgenticSuperAppPluginRuntime, AgenticSuperAppPluginRuntimeError,
};
use agentic_super_app_protocol::{
    current_protocol_version, AgentApprovalDecisionRequest, AgentConversationCreateRequest,
    AgentConversationDetail, AgentConversationQuery, AgentConversationSummary, AgentCreateRequest,
    AgentDashboard, AgentDetail, AgentEventEnvelope, AgentEventsQuery, AgentExportRequest,
    AgentFolderGrant, AgentFolderGrantDeleteRequest, AgentFolderGrantRequest, AgentIdRequest,
    AgentInputRequest, AgentMemoryDeleteRequest, AgentMemoryMutationRequest, AgentMemoryQuery,
    AgentMemorySummary, AgentPluginGrant, AgentPluginGrantRequest, AgentRunControlRequest,
    AgentRunDetail, AgentRunStartRequest, AgentRunSummary, AgentRunsQuery, AgentSkillCatalog,
    AgentSkillConflictResolutionRequest, AgentSkillToggleRequest, AgentUpdateRequest, ApiError,
    ApplicationMode, BackupSummary, BootstrapSnapshot, BuildInformation,
    ChatAttachmentImportRequest, ChatBranchRequest, ChatConversationDetail, ChatCreateRequest,
    ChatDeleteRequest, ChatDraftRequest, ChatEditRequest, ChatEventEnvelope, ChatEventsQuery,
    ChatExportRequest, ChatMessagePart, ChatMetadataRequest, ChatModelTurnRequest,
    ChatProviderMessage, ChatProviderPart, ChatProviderStreamEvent, ChatReasoningEffort,
    ChatSendRequest, ChatSidebarPage, ChatSidebarQuery, ChatStreamRequest, ChatTurnRequest,
    CloseCodePaneRequest, CodeCheckpointDiffRequest, CodeCleanupConfirmRequest, CodeCleanupPreview,
    CodeCleanupPreviewRequest, CodeDagProposal, CodeDagProposalAcceptRequest,
    CodeDagProposalRequest, CodeDispatchCancelRequest, CodeDispatchResumeRequest,
    CodeDispatchTerminalRequest, CodeDocument, CodeFileTree, CodeFileTreeQuery, CodeGitDiff,
    CodeGitDiffRequest, CodeGitStatus, CodeGitStatusRequest, CodeOrchestrationEventEnvelope,
    CodeOrchestrationEventsQuery, CodePaneLayout, CodePaneMutation, CodePaneMutationRequest,
    CodePaneMutationResult, CodePreviewRequest, CodePreviewState, CodePreviewSummary,
    CodeQuestionAnswerRequest, CodeReadFileRequest, CodeReviewRequest, CodeRunCreateRequest,
    CodeRunDetail, CodeRunRequest, CodeRunSummary, CodeRunUpdateRequest, CodeSaveFileRequest,
    CodeSaveLayoutRequest, CodeSnapshot, CodeTaskCreateRequest, CodeTaskDeleteRequest,
    CodeTaskRetryRequest, CodeTaskUpdateRequest, CodeTerminalEvent, CodeTerminalInputRequest,
    CodeTerminalKind, CodeTerminalResizeRequest, CodeTerminalSnapshot, CodeTerminalSnapshotQuery,
    CodeTerminalStartRequest, CodeTerminalStopRequest, CodeTerminalSubscribeRequest,
    CodeTerminalSummary, CodeWorkspaceDetail, CodeWorkspaceOpenRequest, CodeWorkspaceQuery,
    CodeWorkspaceTrust, CodeWorkspaceTrustRequest, CommandEnvelope, CreateCodePaneThreadRequest,
    CreateCodePaneThreadResult, DiagnosticSnapshot, JobState, LaunchCodePaneTerminalRequest,
    LaunchCodePaneTerminalResult, OpenCodePanePreviewRequest, OpenCodePanePreviewResult,
    PluginCatalogEntry, PluginConnectionCreateRequest, PluginConnectionIdRequest,
    PluginConnectionSummary, PluginConnectionUpdateRequest, PluginDryRunRequest,
    PluginInstallRequest, PluginInvocationSummary, ProviderDiagnosticRequest, ResponseEnvelope,
    RetryClass, RoutineCreateRequest, RoutineDetail, RoutineExecution, RoutineExecutionsQuery,
    RoutineIdRequest, RoutineQuery, RoutineSummary, RoutineUpdateRequest, SetActiveModeCommand,
    SharedEventEnvelope, SharedEventKind, UpdateSnapshot, AGENTIC_SUPER_APP_PROTOCOL_VERSION,
};
use agentic_super_app_routine_scheduler::{
    AgenticSuperAppRoutineScheduler, AgenticSuperAppRoutineSchedulerError,
};
use agentic_super_app_secret_store::{
    AgenticSuperAppKeyringSecretStore, AgenticSuperAppSecretStoreHandle,
};
use agentic_super_app_tool_runtime::AgenticSuperAppAuditLog;
use agentic_super_app_workspace_service::{
    AgenticSuperAppWorkspaceError, AgenticSuperAppWorkspaceService,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, Emitter, Manager, State};
#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;
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

struct AgenticSuperAppUpdateState {
    pending: std::sync::Mutex<Option<tauri_plugin_updater::Update>>,
}

impl Default for AgenticSuperAppUpdateState {
    fn default() -> Self {
        Self {
            pending: std::sync::Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgenticSuperAppWindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
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
    agent_runtime: AgenticSuperAppAgentRuntime,
    plugin_runtime: AgenticSuperAppPluginRuntime,
    routine_scheduler: AgenticSuperAppRoutineScheduler,
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
        let previous_shutdown_was_clean = persistence
            .previous_shutdown_was_clean()
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
        let jobs = AgenticSuperAppJobRuntime::new(persistence.clone());
        let secrets: AgenticSuperAppSecretStoreHandle = Arc::new(AgenticSuperAppKeyringSecretStore);
        let provider: Arc<dyn AgenticSuperAppModelProvider> =
            Arc::new(AgenticSuperAppOpenAiResponsesProvider::new(secrets.clone()));
        let notifications =
            AgenticSuperAppNotificationService::new(persistence.clone(), jobs.clone());
        let audit = AgenticSuperAppAuditLog::new(persistence.clone());
        let plugin_runtime =
            AgenticSuperAppPluginRuntime::new(persistence.clone(), secrets.clone(), audit.clone())
                .map_err(|error| error.to_string())?;
        plugin_runtime
            .initialize()
            .await
            .map_err(|error| error.to_string())?;
        let artifacts = AgenticSuperAppArtifactStore::new(artifact_root.clone());
        let agent_runtime = AgenticSuperAppAgentRuntime::new(
            agentic_super_app_persistence::agent::AgenticSuperAppAgentStore::new(
                persistence.clone(),
            ),
            provider.clone(),
            artifacts.clone(),
            audit.clone(),
            artifact_root.join("skills"),
        );
        agent_runtime.set_external_tool_provider(Arc::new(plugin_runtime.clone()));
        let routine_scheduler = AgenticSuperAppRoutineScheduler::new(
            persistence.clone(),
            notifications.clone(),
            Arc::new(agent_runtime.clone()),
        );
        let interrupted_agents = agent_runtime
            .recover()
            .await
            .map_err(|error| error.to_string())?;
        agent_runtime
            .initialize()
            .await
            .map_err(|error| error.to_string())?;
        let recovered_operations =
            interrupted + interrupted_chats + interrupted_orchestration + interrupted_agents;
        let recovery_message = if recovered_operations > 0 {
            Some(format!(
                "Recovered {} interrupted operation(s) after restart.",
                recovered_operations
            ))
        } else if previous_shutdown_was_clean == Some(false) {
            Some(
                "The previous session ended unexpectedly. Review active runs and terminals before continuing."
                    .to_owned(),
            )
        } else {
            None
        };
        let (chat_events, _) = broadcast::channel(512);
        Ok(Self {
            persistence,
            secrets,
            provider,
            jobs,
            notifications,
            audit,
            chat,
            artifacts,
            agent_runtime,
            plugin_runtime,
            routine_scheduler,
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
async fn agentic_super_app_command_set_active_mode(
    command: SetActiveModeCommand,
    state: State<'_, AgenticSuperAppShellState>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<BootstrapSnapshot, ApiError> {
    let mode = command.mode;
    {
        let mut active_mode = state.active_mode.write().map_err(|_| unavailable_error())?;
        *active_mode = mode;
    }
    let mode_json = serde_json::to_string(&mode).map_err(|error| {
        application_error("settings_unavailable", error.to_string(), RetryClass::Safe)
    })?;
    foundation
        .persistence
        .set_setting("shell.active_mode", &mode_json)
        .await
        .map_err(database_error)?;
    Ok(BootstrapSnapshot {
        protocol: current_protocol_version(),
        active_mode: mode,
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

fn update_configuration() -> Result<Option<(url::Url, String)>, ApiError> {
    let endpoint = match std::env::var("AGENTIC_SUPER_APP_UPDATER_ENDPOINT") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return Ok(None),
    };
    let public_key = match std::env::var("AGENTIC_SUPER_APP_UPDATER_PUBKEY") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return Ok(None),
    };
    let endpoint = url::Url::parse(endpoint.trim())
        .map_err(|error| updater_error(format!("Invalid updater endpoint: {error}")))?;
    if endpoint.scheme() != "https" {
        return Err(updater_error(
            "Updater endpoints must use HTTPS for signed release metadata.",
        ));
    }
    Ok(Some((endpoint, public_key)))
}

#[tauri::command]
async fn agentic_super_app_query_update(
    app: tauri::AppHandle,
    state: State<'_, AgenticSuperAppUpdateState>,
) -> Result<UpdateSnapshot, ApiError> {
    let current_version = env!("CARGO_PKG_VERSION").to_owned();
    let Some((endpoint, public_key)) = update_configuration()? else {
        return Ok(UpdateSnapshot {
            configured: false,
            current_version,
            available_version: None,
            notes: None,
            published_at: None,
            status: "not_configured".to_owned(),
        });
    };
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(updater_error)?
        .pubkey(public_key)
        .build()
        .map_err(updater_error)?;
    let update = updater.check().await.map_err(updater_error)?;
    let mut pending = state.pending.lock().map_err(|_| unavailable_error())?;
    let Some(update) = update else {
        *pending = None;
        return Ok(UpdateSnapshot {
            configured: true,
            current_version,
            available_version: None,
            notes: None,
            published_at: None,
            status: "up_to_date".to_owned(),
        });
    };
    let snapshot = UpdateSnapshot {
        configured: true,
        current_version,
        available_version: Some(update.version.clone()),
        notes: update.body.clone(),
        published_at: update.date.map(|value| value.to_string()),
        status: "available".to_owned(),
    };
    *pending = Some(update);
    Ok(snapshot)
}

#[tauri::command]
async fn agentic_super_app_command_install_update(
    state: State<'_, AgenticSuperAppUpdateState>,
) -> Result<(), ApiError> {
    let update = state
        .pending
        .lock()
        .map_err(|_| unavailable_error())?
        .take()
        .ok_or_else(|| {
            application_error(
                "update_not_available",
                "Check for an update before installing one.",
                RetryClass::AfterUserAction,
            )
        })?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(updater_error)
}

#[tauri::command]
async fn agentic_super_app_command_create_backup(
    app: tauri::AppHandle,
    destination: String,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<BackupSummary, ApiError> {
    let destination = PathBuf::from(destination.trim());
    if destination.as_os_str().is_empty() {
        return Err(validation_error("A backup destination is required."));
    }
    let summary = release::create_backup(
        &foundation.persistence,
        &foundation.artifacts,
        &destination,
        env!("CARGO_PKG_VERSION"),
        current_protocol_version().major,
    )
    .await
    .map_err(release_error)?;
    let _ = app.emit("agentic-super-app://backup-created", summary.clone());
    Ok(summary)
}

#[tauri::command]
async fn agentic_super_app_command_prepare_restore(
    app: tauri::AppHandle,
    source: String,
) -> Result<(), ApiError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        application_error("storage_unavailable", error.to_string(), RetryClass::Safe)
    })?;
    release::prepare_restore(Path::new(source.trim()), &app_data_dir).map_err(release_error)?;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        app.request_restart();
    });
    Ok(())
}

#[tauri::command]
async fn agentic_super_app_query_agent_dashboard(
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentDashboard, ApiError> {
    foundation
        .agent_runtime
        .dashboard()
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_agents(
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<agentic_super_app_protocol::AgentSummary>, ApiError> {
    foundation
        .agent_runtime
        .list_agents()
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_agent(
    request: AgentIdRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentDetail, ApiError> {
    foundation
        .agent_runtime
        .agent_detail(&request.agent_id)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_create_agent(
    request: AgentCreateRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentDetail, ApiError> {
    foundation
        .agent_runtime
        .create_agent(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_update_agent(
    request: AgentUpdateRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentDetail, ApiError> {
    foundation
        .agent_runtime
        .update_agent(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_archive_agent(
    request: AgentIdRequest,
    archived: bool,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    foundation
        .agent_runtime
        .archive_agent(&request.agent_id, archived)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_delete_agent(
    request: AgentIdRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    foundation
        .agent_runtime
        .delete_agent(&request.agent_id)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_add_agent_folder(
    request: AgentFolderGrantRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentFolderGrant, ApiError> {
    foundation
        .agent_runtime
        .add_folder(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_delete_agent_folder(
    request: AgentFolderGrantDeleteRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    foundation
        .agent_runtime
        .delete_folder(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_agent_skills(
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentSkillCatalog, ApiError> {
    foundation
        .agent_runtime
        .skill_catalog()
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_toggle_agent_skill(
    request: AgentSkillToggleRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentDetail, ApiError> {
    foundation
        .agent_runtime
        .set_skill(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_resolve_agent_skill_conflict(
    request: AgentSkillConflictResolutionRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentDetail, ApiError> {
    foundation
        .agent_runtime
        .set_skill_conflict(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_agent_memory(
    query: AgentMemoryQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<AgentMemorySummary>, ApiError> {
    foundation
        .agent_runtime
        .memory(&query)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_remember_agent_memory(
    request: AgentMemoryMutationRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentMemorySummary, ApiError> {
    foundation
        .agent_runtime
        .remember(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_delete_agent_memory(
    request: AgentMemoryDeleteRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    foundation
        .agent_runtime
        .delete_memory(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_agent_conversations(
    query: AgentConversationQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<AgentConversationSummary>, ApiError> {
    foundation
        .agent_runtime
        .conversations(&query)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_agent_conversation(
    conversation_id: String,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentConversationDetail, ApiError> {
    foundation
        .agent_runtime
        .conversation(&conversation_id)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_create_agent_conversation(
    request: AgentConversationCreateRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentConversationDetail, ApiError> {
    foundation
        .agent_runtime
        .create_conversation(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_agent_runs(
    query: AgentRunsQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<AgentRunSummary>, ApiError> {
    foundation
        .agent_runtime
        .runs(&query)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_agent_run(
    run_id: String,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentRunDetail, ApiError> {
    foundation
        .agent_runtime
        .run_detail(&run_id)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_agent_events(
    query: AgentEventsQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<AgentEventEnvelope>, ApiError> {
    foundation
        .agent_runtime
        .events(&query)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_stream_agent_events(
    query: AgentEventsQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
    channel: Channel<AgentEventEnvelope>,
) -> Result<(), ApiError> {
    let mut receiver = foundation.agent_runtime.subscribe();
    let backlog = foundation
        .agent_runtime
        .events(&query)
        .await
        .map_err(agent_runtime_error)?;
    let cursor = backlog
        .last()
        .map(|event| event.sequence)
        .unwrap_or(query.after_sequence);
    for event in backlog {
        if channel.send(event).is_err() {
            return Ok(());
        }
    }
    let run_id = query.run_id;
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = receiver.recv().await {
            if event.run_id != run_id || event.sequence <= cursor {
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
async fn agentic_super_app_command_start_agent_run(
    request: AgentRunStartRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentRunSummary, ApiError> {
    foundation
        .agent_runtime
        .start_run(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_resume_agent_run(
    request: AgentRunControlRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentRunSummary, ApiError> {
    foundation
        .agent_runtime
        .resume_run(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_cancel_agent_run(
    request: AgentRunControlRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentRunSummary, ApiError> {
    foundation
        .agent_runtime
        .cancel_run(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_decide_agent_approval(
    request: AgentApprovalDecisionRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentRunSummary, ApiError> {
    foundation
        .agent_runtime
        .decide_approval(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_submit_agent_input(
    request: AgentInputRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentRunSummary, ApiError> {
    foundation
        .agent_runtime
        .submit_input(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_export_agent(
    request: AgentExportRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    foundation
        .agent_runtime
        .export_agent(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_routines(
    query: RoutineQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<RoutineSummary>, ApiError> {
    foundation
        .routine_scheduler
        .list(&query)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn agentic_super_app_query_routine(
    request: RoutineIdRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<RoutineDetail, ApiError> {
    foundation
        .routine_scheduler
        .detail(&request.routine_id)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn agentic_super_app_command_create_routine(
    request: RoutineCreateRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<RoutineDetail, ApiError> {
    foundation
        .routine_scheduler
        .create(&request)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn agentic_super_app_command_update_routine(
    request: RoutineUpdateRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<RoutineDetail, ApiError> {
    foundation
        .routine_scheduler
        .update(&request)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn agentic_super_app_command_archive_routine(
    request: RoutineIdRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    foundation
        .routine_scheduler
        .archive(&request)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn agentic_super_app_command_run_routine_now(
    request: RoutineIdRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<RoutineExecution, ApiError> {
    foundation
        .routine_scheduler
        .run_now(&request.routine_id)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn agentic_super_app_query_routine_executions(
    query: RoutineExecutionsQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<RoutineExecution>, ApiError> {
    foundation
        .routine_scheduler
        .executions(&query.routine_id, query.limit.unwrap_or(50))
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn agentic_super_app_query_plugin_catalog(
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<PluginCatalogEntry>, ApiError> {
    foundation
        .plugin_runtime
        .catalog()
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_plugin_connections(
    plugin_id: Option<String>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<PluginConnectionSummary>, ApiError> {
    foundation
        .plugin_runtime
        .connections(plugin_id.as_deref())
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_install_plugin(
    request: PluginInstallRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    foundation
        .plugin_runtime
        .install(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_create_plugin_connection(
    request: PluginConnectionCreateRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<PluginConnectionSummary, ApiError> {
    foundation
        .plugin_runtime
        .create_connection(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_update_plugin_connection(
    request: PluginConnectionUpdateRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<PluginConnectionSummary, ApiError> {
    foundation
        .plugin_runtime
        .update_connection(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_delete_plugin_connection(
    request: PluginConnectionIdRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<(), ApiError> {
    foundation
        .plugin_runtime
        .delete_connection(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_test_plugin_connection(
    request: PluginConnectionIdRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<PluginConnectionSummary, ApiError> {
    foundation
        .plugin_runtime
        .test_connection(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_agent_plugin_grants(
    request: AgentIdRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<AgentPluginGrant>, ApiError> {
    foundation
        .plugin_runtime
        .agent_grants(&request.agent_id)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_set_agent_plugin_grant(
    request: AgentPluginGrantRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<AgentPluginGrant, ApiError> {
    foundation
        .plugin_runtime
        .set_agent_grant(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_command_dry_run_plugin(
    request: PluginDryRunRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<String, ApiError> {
    foundation
        .plugin_runtime
        .dry_run(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn agentic_super_app_query_plugin_invocations(
    run_id: String,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<Vec<PluginInvocationSummary>, ApiError> {
    foundation
        .plugin_runtime
        .invocations_for_run(&run_id)
        .await
        .map_err(plugin_runtime_error)
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
async fn agentic_super_app_command_resume_code_dispatch(
    command: CommandEnvelope<CodeDispatchResumeRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .resume_dispatch(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_cancel_code_dispatch(
    command: CommandEnvelope<CodeDispatchCancelRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodeRunDetail>, ApiError> {
    validate_code_command(&command)?;
    let detail = foundation
        .code_orchestration
        .cancel_dispatch(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn agentic_super_app_command_open_code_dispatch_terminal(
    command: CommandEnvelope<CodeDispatchTerminalRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
    channel: Channel<CodeTerminalEvent>,
) -> Result<ResponseEnvelope<CodeTerminalSummary>, ApiError> {
    validate_code_command(&command)?;
    let context = foundation
        .code_orchestration
        .dispatch_terminal_context(&command.payload)
        .await
        .map_err(orchestration_error)?;
    let persistence = foundation.persistence.clone();
    let coding_agent = context.resume_session_id.is_some();
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
        .start_at_root(
            &CodeTerminalStartRequest {
                workspace_id: context.workspace_id,
                kind: if coding_agent {
                    agentic_super_app_protocol::CodeTerminalKind::CodingAgent
                } else {
                    agentic_super_app_protocol::CodeTerminalKind::Shell
                },
                cols: command.payload.cols,
                rows: command.payload.rows,
                adapter_id: coding_agent.then_some(context.adapter_id),
                model: coding_agent.then_some(context.model).flatten(),
                resume_session_id: coding_agent.then_some(context.resume_session_id).flatten(),
            },
            &context.worktree_path,
            sink,
        )
        .map_err(runtime_error)?;
    let attached = foundation
        .persistence
        .attach_orchestration_terminal(
            &command.payload.dispatch_id,
            context.lease_generation,
            &summary.id,
        )
        .await
        .map_err(database_error)?;
    if !attached {
        let _ = foundation.code_runtime.stop(&CodeTerminalStopRequest {
            terminal_id: summary.id.clone(),
            force: true,
        });
        return Err(validation_error(
            "The dispatch lease changed before the terminal could be attached.",
        ));
    }
    foundation
        .persistence
        .save_code_terminal(&summary)
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, summary))
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
    if command.payload.force {
        if let Ok(detail) = foundation
            .code_orchestration
            .detail(&command.payload.run_id)
            .await
        {
            for dispatch in detail.dispatches.iter().filter(|dispatch| {
                detail.worktrees.iter().any(|worktree| {
                    worktree.id == command.payload.worktree_id
                        && worktree.dispatch_id == dispatch.id
                })
            }) {
                if let Some(terminal_id) = dispatch.terminal_id.as_deref() {
                    let _ = foundation.code_runtime.stop(&CodeTerminalStopRequest {
                        terminal_id: terminal_id.to_owned(),
                        force: true,
                    });
                }
            }
        }
    }
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
            Some("host-validated sandboxed renderer iframe with credential-free URL policy"),
        )
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, preview))
}

#[tauri::command]
async fn agentic_super_app_command_apply_code_pane_mutation(
    command: CommandEnvelope<CodePaneMutationRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodePaneMutationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace_id = &command.payload.workspace_id;
    let expected_revision = command.payload.expected_revision;

    let current_layout = match foundation
        .persistence
        .code_layout(workspace_id)
        .await
        .map_err(database_error)?
    {
        Some(layout) if layout.workspace_id == *workspace_id => layout,
        _ => default_layout(workspace_id),
    };

    if current_layout.revision != expected_revision {
        return Err(application_error(
            "layout_conflict",
            format!(
                "Pane layout was modified elsewhere (current revision {}, expected {}).",
                current_layout.revision, expected_revision
            ),
            RetryClass::AfterUserAction,
        ));
    }

    let mutated_layout = match &command.payload.mutation {
        CodePaneMutation::Split { pane_id, placement } => {
            agentic_super_app_code_domain::split_pane(&current_layout, pane_id, *placement)
                .map_err(|e| validation_error(e.to_string()))?
        }
        CodePaneMutation::Rename { pane_id, title } => {
            agentic_super_app_code_domain::rename_pane(&current_layout, pane_id, title)
                .map_err(|e| validation_error(e.to_string()))?
        }
        CodePaneMutation::Move {
            pane_id,
            target_pane_id,
            placement,
        } => agentic_super_app_code_domain::move_pane(
            &current_layout,
            pane_id,
            target_pane_id,
            *placement,
        )
        .map_err(|e| validation_error(e.to_string()))?,
        CodePaneMutation::Resize {
            split_id,
            ratio_percent,
        } => agentic_super_app_code_domain::resize_split(&current_layout, split_id, *ratio_percent)
            .map_err(|e| validation_error(e.to_string()))?,
        CodePaneMutation::Focus { pane_id } => {
            agentic_super_app_code_domain::focus_pane(&current_layout, pane_id)
                .map_err(|e| validation_error(e.to_string()))?
        }
        CodePaneMutation::Maximize { pane_id } => {
            agentic_super_app_code_domain::set_maximized_pane(&current_layout, pane_id.as_deref())
                .map_err(|e| validation_error(e.to_string()))?
        }
        CodePaneMutation::ApplyPreset { preset } => {
            agentic_super_app_code_domain::apply_layout_preset(&current_layout, *preset)
                .map_err(|e| validation_error(e.to_string()))?
        }
    };

    let saved_layout = foundation
        .persistence
        .mutate_code_layout(workspace_id, expected_revision, &mutated_layout)
        .await
        .map_err(|e| {
            if e.to_string().contains("layout_conflict") {
                application_error(
                    "layout_conflict",
                    "Layout conflict on save",
                    RetryClass::AfterUserAction,
                )
            } else {
                database_error(e)
            }
        })?;

    Ok(response(
        &command.request_id,
        CodePaneMutationResult {
            layout: saved_layout,
        },
    ))
}

#[tauri::command]
async fn agentic_super_app_command_launch_code_pane_terminal(
    command: CommandEnvelope<LaunchCodePaneTerminalRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
    channel: Channel<CodeTerminalEvent>,
) -> Result<ResponseEnvelope<LaunchCodePaneTerminalResult>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            agentic_super_app_protocol::CodeWorkspaceCapability::ExecuteProcesses,
        )
        .map_err(workspace_error)?;
    let root = foundation
        .code_workspaces
        .root_path(&command.payload.workspace_id)
        .map_err(workspace_error)?;

    let current_layout = match foundation
        .persistence
        .code_layout(&command.payload.workspace_id)
        .await
        .map_err(database_error)?
    {
        Some(layout) if layout.workspace_id == command.payload.workspace_id => layout,
        _ => default_layout(&command.payload.workspace_id),
    };

    if current_layout.revision != command.payload.expected_revision {
        return Err(application_error(
            "layout_conflict",
            format!(
                "Pane layout was modified elsewhere (current revision {}, expected {}).",
                current_layout.revision, command.payload.expected_revision
            ),
            RetryClass::AfterUserAction,
        ));
    }

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

    let terminal_start = CodeTerminalStartRequest {
        workspace_id: command.payload.workspace_id.clone(),
        kind: command.payload.kind,
        cols: command.payload.cols,
        rows: command.payload.rows,
        adapter_id: command.payload.adapter_id.clone(),
        model: command.payload.model.clone(),
        resume_session_id: None,
    };

    let summary = foundation
        .code_runtime
        .start(&terminal_start, &root, sink)
        .map_err(runtime_error)?;

    foundation
        .persistence
        .save_code_terminal(&summary)
        .await
        .map_err(database_error)?;

    let pane_title = if summary.kind == CodeTerminalKind::CodingAgent {
        summary
            .adapter_id
            .clone()
            .unwrap_or_else(|| "Coding Agent".to_owned())
    } else {
        "Terminal".to_owned()
    };

    let pane_kind = if summary.kind == CodeTerminalKind::CodingAgent {
        agentic_super_app_protocol::CodePaneKind::CodingAgent
    } else {
        agentic_super_app_protocol::CodePaneKind::Terminal
    };

    let mut new_layout = current_layout.clone();
    if let Some(node) = new_layout
        .nodes
        .iter_mut()
        .find(|n| n.pane_id == command.payload.pane_id)
    {
        node.kind = pane_kind;
        node.resource_id = Some(summary.id.clone());
        node.title = Some(pane_title);
    } else {
        let _ = foundation.code_runtime.stop(&CodeTerminalStopRequest {
            terminal_id: summary.id,
            force: true,
        });
        return Err(validation_error("Target pane was not found."));
    }
    new_layout.focused_pane_id = Some(command.payload.pane_id.clone());

    let saved_layout = match foundation
        .persistence
        .mutate_code_layout(
            &command.payload.workspace_id,
            command.payload.expected_revision,
            &new_layout,
        )
        .await
    {
        Ok(l) => l,
        Err(err) => {
            let _ = foundation.code_runtime.stop(&CodeTerminalStopRequest {
                terminal_id: summary.id,
                force: true,
            });
            return Err(if err.to_string().contains("layout_conflict") {
                application_error(
                    "layout_conflict",
                    "Layout conflict on save",
                    RetryClass::AfterUserAction,
                )
            } else {
                database_error(err)
            });
        }
    };

    foundation
        .audit
        .record(
            "code.pane.terminal.launch",
            "success",
            "info",
            Some(&summary.id),
            Some("docked terminal pane launched"),
        )
        .await
        .map_err(database_error)?;

    Ok(response(
        &command.request_id,
        LaunchCodePaneTerminalResult {
            layout: saved_layout,
            terminal: summary,
        },
    ))
}

#[tauri::command]
async fn agentic_super_app_command_open_code_pane_preview(
    command: CommandEnvelope<OpenCodePanePreviewRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<OpenCodePanePreviewResult>, ApiError> {
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
    let preview_id = format!("agentic-preview-{}", uuid::Uuid::now_v7());
    let preview = CodePreviewSummary {
        id: preview_id.clone(),
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

    let current_layout = match foundation
        .persistence
        .code_layout(&command.payload.workspace_id)
        .await
        .map_err(database_error)?
    {
        Some(layout) if layout.workspace_id == command.payload.workspace_id => layout,
        _ => default_layout(&command.payload.workspace_id),
    };

    if current_layout.revision != command.payload.expected_revision {
        return Err(application_error(
            "layout_conflict",
            format!(
                "Pane layout was modified elsewhere (current revision {}, expected {}).",
                current_layout.revision, command.payload.expected_revision
            ),
            RetryClass::AfterUserAction,
        ));
    }

    let mut new_layout = current_layout.clone();
    let preview_title = url.host_str().unwrap_or("Preview").to_owned();
    if let Some(node) = new_layout
        .nodes
        .iter_mut()
        .find(|n| n.pane_id == command.payload.pane_id)
    {
        node.kind = agentic_super_app_protocol::CodePaneKind::Preview;
        node.resource_id = Some(preview_id);
        node.title = Some(preview_title);
    } else {
        return Err(validation_error("Target pane was not found."));
    }
    new_layout.focused_pane_id = Some(command.payload.pane_id.clone());

    let saved_layout = foundation
        .persistence
        .mutate_code_layout(
            &command.payload.workspace_id,
            command.payload.expected_revision,
            &new_layout,
        )
        .await
        .map_err(|err| {
            if err.to_string().contains("layout_conflict") {
                application_error(
                    "layout_conflict",
                    "Layout conflict on save",
                    RetryClass::AfterUserAction,
                )
            } else {
                database_error(err)
            }
        })?;

    Ok(response(
        &command.request_id,
        OpenCodePanePreviewResult {
            layout: saved_layout,
            preview,
        },
    ))
}

#[tauri::command]
async fn agentic_super_app_command_create_code_pane_thread(
    command: CommandEnvelope<CreateCodePaneThreadRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CreateCodePaneThreadResult>, ApiError> {
    validate_code_command(&command)?;

    let create_req = ChatCreateRequest {
        title: Some("Workspace Thread".to_owned()),
    };
    let detail = foundation
        .chat
        .create(&create_req, Some(&command.request_id))
        .await
        .map_err(chat_error)?;

    let current_layout = match foundation
        .persistence
        .code_layout(&command.payload.workspace_id)
        .await
        .map_err(database_error)?
    {
        Some(layout) if layout.workspace_id == command.payload.workspace_id => layout,
        _ => default_layout(&command.payload.workspace_id),
    };

    if current_layout.revision != command.payload.expected_revision {
        return Err(application_error(
            "layout_conflict",
            format!(
                "Pane layout was modified elsewhere (current revision {}, expected {}).",
                current_layout.revision, command.payload.expected_revision
            ),
            RetryClass::AfterUserAction,
        ));
    }

    let mut new_layout = current_layout.clone();
    let thread_title = detail.title.clone();
    if let Some(node) = new_layout
        .nodes
        .iter_mut()
        .find(|n| n.pane_id == command.payload.pane_id)
    {
        node.kind = agentic_super_app_protocol::CodePaneKind::Thread;
        node.resource_id = Some(detail.id.clone());
        node.title = Some(thread_title);
    } else {
        return Err(validation_error("Target pane was not found."));
    }
    new_layout.focused_pane_id = Some(command.payload.pane_id.clone());

    let saved_layout = foundation
        .persistence
        .mutate_code_layout(
            &command.payload.workspace_id,
            command.payload.expected_revision,
            &new_layout,
        )
        .await
        .map_err(|err| {
            if err.to_string().contains("layout_conflict") {
                application_error(
                    "layout_conflict",
                    "Layout conflict on save",
                    RetryClass::AfterUserAction,
                )
            } else {
                database_error(err)
            }
        })?;

    Ok(response(
        &command.request_id,
        CreateCodePaneThreadResult {
            layout: saved_layout,
            conversation: detail,
        },
    ))
}

#[tauri::command]
async fn agentic_super_app_command_close_code_pane(
    command: CommandEnvelope<CloseCodePaneRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<CodePaneMutationResult>, ApiError> {
    validate_code_command(&command)?;

    let current_layout = match foundation
        .persistence
        .code_layout(&command.payload.workspace_id)
        .await
        .map_err(database_error)?
    {
        Some(layout) if layout.workspace_id == command.payload.workspace_id => layout,
        _ => default_layout(&command.payload.workspace_id),
    };

    if current_layout.revision != command.payload.expected_revision {
        return Err(application_error(
            "layout_conflict",
            format!(
                "Pane layout was modified elsewhere (current revision {}, expected {}).",
                current_layout.revision, command.payload.expected_revision
            ),
            RetryClass::AfterUserAction,
        ));
    }

    if let Some(pane) = current_layout
        .nodes
        .iter()
        .find(|n| n.pane_id == command.payload.pane_id)
    {
        if matches!(
            pane.kind,
            agentic_super_app_protocol::CodePaneKind::Terminal
                | agentic_super_app_protocol::CodePaneKind::CodingAgent
        ) {
            if let Some(resource_id) = &pane.resource_id {
                let is_running = foundation
                    .code_runtime
                    .list()
                    .map_err(runtime_error)?
                    .into_iter()
                    .any(|t| {
                        t.id == *resource_id
                            && matches!(
                                t.state,
                                agentic_super_app_protocol::CodeTerminalState::Running
                                    | agentic_super_app_protocol::CodeTerminalState::Starting
                            )
                    });

                if is_running {
                    if !command.payload.terminate_running_resource {
                        return Err(application_error(
                            "resource_running",
                            "The terminal in this pane is still running. Stop it or confirm termination.",
                            RetryClass::AfterUserAction,
                        ));
                    } else {
                        let _ = foundation.code_runtime.stop(&CodeTerminalStopRequest {
                            terminal_id: resource_id.clone(),
                            force: true,
                        });
                        let _ = foundation
                            .persistence
                            .finish_code_terminal(
                                resource_id,
                                agentic_super_app_protocol::CodeTerminalState::Interrupted,
                                None,
                            )
                            .await;
                    }
                }
            }
        }
    }

    let mutated_layout = agentic_super_app_code_domain::close_pane_and_collapse(
        &current_layout,
        &command.payload.pane_id,
    )
    .map_err(|e| validation_error(e.to_string()))?;

    let saved_layout = foundation
        .persistence
        .mutate_code_layout(
            &command.payload.workspace_id,
            command.payload.expected_revision,
            &mutated_layout,
        )
        .await
        .map_err(|err| {
            if err.to_string().contains("layout_conflict") {
                application_error(
                    "layout_conflict",
                    "Layout conflict on save",
                    RetryClass::AfterUserAction,
                )
            } else {
                database_error(err)
            }
        })?;

    Ok(response(
        &command.request_id,
        CodePaneMutationResult {
            layout: saved_layout,
        },
    ))
}

#[tauri::command]
async fn agentic_super_app_query_code_terminal_snapshot(
    query: CodeTerminalSnapshotQuery,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<CodeTerminalSnapshot, ApiError> {
    foundation
        .code_runtime
        .snapshot(&query.terminal_id)
        .map_err(runtime_error)
}

#[tauri::command]
async fn agentic_super_app_stream_code_terminal_events(
    request: CodeTerminalSubscribeRequest,
    foundation: State<'_, AgenticSuperAppFoundation>,
    channel: Channel<CodeTerminalEvent>,
) -> Result<(), ApiError> {
    let mut receiver = foundation
        .code_runtime
        .subscribe(&request.terminal_id)
        .map_err(runtime_error)?;

    loop {
        match receiver.recv().await {
            Ok(event) => {
                if event.sequence <= request.after_sequence {
                    continue;
                }
                if channel.send(event).is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                // The renderer will compare the next sequence with its local
                // cursor and reload the bounded PTY snapshot if a gap exists.
                continue;
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
    Ok(())
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

async fn resolve_chat_engine_secret(
    foundation: &AgenticSuperAppFoundation,
    engine_id: &str,
    action: &str,
) -> Result<Option<String>, ApiError> {
    if engine_id == AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID {
        return foundation
            .persistence
            .provider_secret_ref()
            .await
            .map_err(database_error)?
            .ok_or_else(|| validation_error(format!("Store an API key before {action}.")))
            .map(Some);
    }
    let adapter = foundation
        .code_runtime
        .adapters()
        .into_iter()
        .find(|adapter| adapter.id == engine_id)
        .ok_or_else(|| validation_error("Unknown local engine."))?;
    if !adapter.detected {
        return Err(validation_error(format!(
            "{} was not detected on this host. Install it and restart the app before {action}.",
            adapter.display_name
        )));
    }
    Ok(None)
}

#[tauri::command]
async fn agentic_super_app_command_start_chat_turn(
    command: CommandEnvelope<ChatSendRequest>,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<ResponseEnvelope<ChatConversationDetail>, ApiError> {
    validate_chat_command(&command)?;
    validate_send_request(&command.payload).map_err(|error| validation_error(error.to_string()))?;
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
    let engine_id = command.payload.provider_account_id.clone();
    let secret = resolve_chat_engine_secret(&foundation, &engine_id, "starting a chat").await?;
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
        engine_id,
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
    let (engine_id, stored_model) = foundation
        .chat
        .turn_configuration(&command.payload.conversation_id, &command.payload.turn_id)
        .await
        .map_err(chat_error)?
        .ok_or_else(|| validation_error("The chat turn configuration is unavailable."))?;
    let default_model = if engine_id == AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID {
        foundation
            .persistence
            .provider_accounts()
            .await
            .map_err(database_error)?
            .into_iter()
            .find(|account| account.id == AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID)
            .and_then(|account| account.default_model)
    } else {
        None
    };
    let model = command
        .payload
        .model
        .clone()
        .or_else(|| (!stored_model.trim().is_empty()).then_some(stored_model))
        .or(default_model)
        .unwrap_or_else(|| "default".to_owned());
    let effort = command
        .payload
        .reasoning_effort
        .unwrap_or(ChatReasoningEffort::Auto);
    let request = ChatSendRequest {
        conversation_id: command.payload.conversation_id.clone(),
        branch_id: String::new(),
        text: String::new(),
        attachment_ids: Vec::new(),
        provider_account_id: engine_id.clone(),
        model,
        reasoning_effort: effort,
    };
    let secret = resolve_chat_engine_secret(&foundation, &engine_id, "retrying a chat").await?;
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
        engine_id,
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
    let engine_id = command.payload.provider_account_id.clone();
    let secret = resolve_chat_engine_secret(&foundation, &engine_id, "editing a chat").await?;
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
        engine_id,
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
    secret: Option<String>,
    engine_id: String,
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
    let provider_future = stream_chat_engine(
        &foundation,
        &engine_id,
        secret.as_deref(),
        request,
        cancellation.clone(),
        callback,
    );
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

async fn stream_chat_engine(
    foundation: &AgenticSuperAppFoundation,
    engine_id: &str,
    secret: Option<&str>,
    request: ChatModelTurnRequest,
    cancellation: CancellationToken,
    callback: Arc<dyn Fn(ChatProviderStreamEvent) + Send + Sync + 'static>,
) -> Result<(), AgenticSuperAppProviderError> {
    if engine_id == AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID {
        return foundation
            .provider
            .stream_chat_turn(
                secret.ok_or(AgenticSuperAppProviderError::CredentialsUnavailable)?,
                request,
                cancellation,
                callback,
            )
            .await;
    }
    let prompt = render_chat_cli_prompt(&request);
    stream_cli_chat_turn(engine_id, &request.model, &prompt, cancellation, callback)
        .await
        .map_err(|error| match error {
            AgenticSuperAppCodeRuntimeError::Cancelled => AgenticSuperAppProviderError::Cancelled,
            other => AgenticSuperAppProviderError::Request(other.to_string()),
        })
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

fn render_chat_cli_prompt(request: &ChatModelTurnRequest) -> String {
    const MAX_PROMPT_BYTES: usize = 180 * 1024;
    let mut prompt = String::from(
        "You are responding in a focused desktop chat. Tools, file access, and workspace edits are disabled. Use the conversation below as context and answer the latest user message directly.\n\n",
    );
    for message in &request.messages {
        prompt.push_str("[ ");
        prompt.push_str(&format!("{:?}", message.role).to_lowercase());
        prompt.push_str(" ]\n");
        for part in &message.parts {
            if let Some(text) = part.text.as_deref().filter(|text| !text.is_empty()) {
                prompt.push_str(text);
                prompt.push('\n');
            } else if part.kind == "file" {
                if let Some(data_url) = part.data_url.as_deref() {
                    if let Some(encoded) = data_url.split_once(",").map(|(_, value)| value) {
                        if let Ok(bytes) = STANDARD.decode(encoded) {
                            if let Ok(text) = String::from_utf8(bytes) {
                                prompt.push_str("[Attached text content]\n");
                                prompt.push_str(&text.chars().take(32_000).collect::<String>());
                                prompt.push('\n');
                                continue;
                            }
                        }
                    }
                }
                prompt.push_str("[Attached file content is not representable as text]\n");
            } else if let Some(file_name) = part.file_name.as_deref() {
                prompt.push_str("[Attached ");
                prompt.push_str(part.kind.as_str());
                prompt.push_str(": ");
                prompt.push_str(file_name);
                if let Some(mime_type) = part.mime_type.as_deref() {
                    prompt.push_str(" ( ");
                    prompt.push_str(mime_type);
                    prompt.push_str(" )");
                }
                prompt.push_str("]\n");
            }
        }
        prompt.push('\n');
    }
    if prompt.len() > MAX_PROMPT_BYTES {
        prompt.truncate(MAX_PROMPT_BYTES);
        prompt.push_str("\n\n[Earlier context was truncated by the local chat safety limit.]");
    }
    prompt
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
        AgenticSuperAppCodeRuntimeError::Cancelled => (
            "terminal_cancelled",
            "The coding-agent process was cancelled.",
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

fn routine_scheduler_error(error: AgenticSuperAppRoutineSchedulerError) -> ApiError {
    match error {
        AgenticSuperAppRoutineSchedulerError::InvalidSchedule(message) => {
            validation_error(message)
        }
        AgenticSuperAppRoutineSchedulerError::Launcher(message) => application_error(
            "routine_launcher_failed",
            message,
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppRoutineSchedulerError::Store(error) => match error {
            agentic_super_app_persistence::routine::AgenticSuperAppRoutineStoreError::InvalidInput(
                message,
            ) => validation_error(message),
            agentic_super_app_persistence::routine::AgenticSuperAppRoutineStoreError::NotFound => {
                application_error(
                    "routine_not_found",
                    "The routine is no longer available.",
                    RetryClass::AfterUserAction,
                )
            }
            agentic_super_app_persistence::routine::AgenticSuperAppRoutineStoreError::Conflict => {
                application_error(
                    "routine_conflict",
                    "The routine changed or conflicts with existing state.",
                    RetryClass::AfterUserAction,
                )
            }
            agentic_super_app_persistence::routine::AgenticSuperAppRoutineStoreError::Database(
                error,
            ) => database_error(error),
            agentic_super_app_persistence::routine::AgenticSuperAppRoutineStoreError::Serialization(
                _,
            ) => application_error(
                "routine_serialization_failed",
                "The routine data could not be encoded.",
                RetryClass::Safe,
            ),
        },
    }
}

fn plugin_runtime_error(error: AgenticSuperAppPluginRuntimeError) -> ApiError {
    match error {
        AgenticSuperAppPluginRuntimeError::InvalidInput(message) => validation_error(message),
        AgenticSuperAppPluginRuntimeError::NotFound(item) => application_error(
            "plugin_not_found",
            format!("The plugin resource '{item}' is no longer available."),
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppPluginRuntimeError::Secret(_) => application_error(
            "secret_store_unavailable",
            "The operating system credential store is unavailable.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppPluginRuntimeError::Request(_) => application_error(
            "plugin_request_failed",
            "The plugin request failed. Check the connection and try again.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppPluginRuntimeError::InvalidResponse => application_error(
            "plugin_invalid_response",
            "The plugin returned an invalid or oversized JSON response.",
            RetryClass::AfterUserAction,
        ),
        AgenticSuperAppPluginRuntimeError::Serialization(_) => application_error(
            "plugin_serialization_failed",
            "The plugin data could not be encoded.",
            RetryClass::Safe,
        ),
        AgenticSuperAppPluginRuntimeError::Store(error) => match error {
            agentic_super_app_persistence::plugin::AgenticSuperAppPluginStoreError::InvalidInput(
                message,
            ) => validation_error(message),
            agentic_super_app_persistence::plugin::AgenticSuperAppPluginStoreError::NotFound => {
                application_error(
                    "plugin_not_found",
                    "The plugin resource is no longer available.",
                    RetryClass::AfterUserAction,
                )
            }
            agentic_super_app_persistence::plugin::AgenticSuperAppPluginStoreError::Conflict => {
                application_error(
                    "plugin_conflict",
                    "The plugin connection or grant conflicts with existing state.",
                    RetryClass::AfterUserAction,
                )
            }
            agentic_super_app_persistence::plugin::AgenticSuperAppPluginStoreError::Database(
                error,
            ) => database_error(error),
            agentic_super_app_persistence::plugin::AgenticSuperAppPluginStoreError::Serialization(
                _,
            ) => application_error(
                "plugin_serialization_failed",
                "The plugin data could not be encoded.",
                RetryClass::Safe,
            ),
        },
        AgenticSuperAppPluginRuntimeError::RoutineStore(_) => application_error(
            "persistence_unavailable",
            "Routine execution state is unavailable.",
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
async fn agentic_super_app_command_mark_notification_read(
    notification_id: String,
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<bool, ApiError> {
    foundation
        .persistence
        .mark_notification_read(notification_id.trim())
        .await
        .map_err(database_error)
}

#[tauri::command]
async fn agentic_super_app_command_mark_all_notifications_read(
    foundation: State<'_, AgenticSuperAppFoundation>,
) -> Result<u64, ApiError> {
    foundation
        .persistence
        .mark_all_notifications_read()
        .await
        .map_err(database_error)
}

fn start_native_notification_bridge(app: tauri::AppHandle, jobs: AgenticSuperAppJobRuntime) {
    let mut receiver = jobs.subscribe();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = receiver.recv().await {
            if event.kind != SharedEventKind::NotificationCreated || !event.native_notification {
                continue;
            }
            let Some(title) = event.message else {
                continue;
            };
            let body = event
                .text_delta
                .unwrap_or_else(|| "A new notification is available.".to_owned());
            let _ = app.notification().builder().title(title).body(body).show();
        }
    });
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn install_tray(app: &mut tauri::App) -> Result<(), tauri::Error> {
    let open = MenuItem::with_id(app, "open", "Open Agentic Super App", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/32x32.png"
        ))?)
        .menu(&menu)
        .tooltip("Agentic Super App")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(desktop)]
            install_tray(app).map_err(Box::<dyn std::error::Error>::from)?;
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            let database_path = app_data_dir.join("agentic-super-app.sqlite3");
            let artifact_root = app_data_dir.join("artifacts");
            let orchestration_root = app_data_dir.join("orchestration");
            release::apply_pending_restore(&app_data_dir, &database_path, &artifact_root)
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            let foundation = tauri::async_runtime::block_on(AgenticSuperAppFoundation::open(
                database_path,
                artifact_root,
                orchestration_root,
            ))
            .map_err(Box::<dyn std::error::Error>::from)?;
            tauri::async_runtime::block_on(
                foundation
                    .persistence
                    .record_startup(env!("CARGO_PKG_VERSION"), current_protocol_version().major),
            )
            .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            let active_mode = tauri::async_runtime::block_on(
                foundation.persistence.get_setting("shell.active_mode"),
            )
            .ok()
            .flatten()
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or(ApplicationMode::Agent);
            if let Some(window) = app.get_webview_window("main") {
                let saved_window = tauri::async_runtime::block_on(
                    foundation.persistence.get_setting("shell.window_state"),
                )
                .ok()
                .flatten()
                .and_then(|value| serde_json::from_str::<AgenticSuperAppWindowState>(&value).ok());
                if let Some(saved_window) = saved_window {
                    if saved_window.width >= 900 && saved_window.height >= 620 {
                        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                            saved_window.width,
                            saved_window.height,
                        )));
                    }
                    let _ = window.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition::new(saved_window.x, saved_window.y),
                    ));
                    if saved_window.maximized {
                        let _ = window.maximize();
                    }
                }
            }
            app.manage(AgenticSuperAppShellState {
                active_mode: RwLock::new(active_mode),
            });
            app.manage(AgenticSuperAppUpdateState::default());
            let routine_scheduler = foundation.routine_scheduler.clone();
            tauri::async_runtime::spawn(async move {
                routine_scheduler.run().await;
            });
            start_native_notification_bridge(app.handle().clone(), foundation.jobs.clone());
            app.manage(foundation);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Some(foundation) =
                    window.app_handle().try_state::<AgenticSuperAppFoundation>()
                {
                    if let (Ok(position), Ok(size), Ok(maximized)) = (
                        window.outer_position(),
                        window.outer_size(),
                        window.is_maximized(),
                    ) {
                        if let Ok(value) = serde_json::to_string(&AgenticSuperAppWindowState {
                            x: position.x,
                            y: position.y,
                            width: size.width,
                            height: size.height,
                            maximized,
                        }) {
                            let _ = tauri::async_runtime::block_on(
                                foundation
                                    .persistence
                                    .set_setting("shell.window_state", &value),
                            );
                        }
                    }
                    let _ = tauri::async_runtime::block_on(
                        foundation.persistence.record_clean_shutdown(),
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            agentic_super_app_query_bootstrap,
            agentic_super_app_command_set_active_mode,
            agentic_super_app_query_build_information,
            agentic_super_app_query_diagnostic_snapshot,
            agentic_super_app_query_update,
            agentic_super_app_command_install_update,
            agentic_super_app_command_create_backup,
            agentic_super_app_command_prepare_restore,
            agentic_super_app_query_agent_dashboard,
            agentic_super_app_query_agents,
            agentic_super_app_query_agent,
            agentic_super_app_command_create_agent,
            agentic_super_app_command_update_agent,
            agentic_super_app_command_archive_agent,
            agentic_super_app_command_delete_agent,
            agentic_super_app_command_add_agent_folder,
            agentic_super_app_command_delete_agent_folder,
            agentic_super_app_query_agent_skills,
            agentic_super_app_command_toggle_agent_skill,
            agentic_super_app_command_resolve_agent_skill_conflict,
            agentic_super_app_query_agent_memory,
            agentic_super_app_command_remember_agent_memory,
            agentic_super_app_command_delete_agent_memory,
            agentic_super_app_query_agent_conversations,
            agentic_super_app_query_agent_conversation,
            agentic_super_app_command_create_agent_conversation,
            agentic_super_app_query_agent_runs,
            agentic_super_app_query_agent_run,
            agentic_super_app_query_agent_events,
            agentic_super_app_stream_agent_events,
            agentic_super_app_command_start_agent_run,
            agentic_super_app_command_resume_agent_run,
            agentic_super_app_command_cancel_agent_run,
            agentic_super_app_command_decide_agent_approval,
            agentic_super_app_command_submit_agent_input,
            agentic_super_app_command_export_agent,
            agentic_super_app_query_routines,
            agentic_super_app_query_routine,
            agentic_super_app_command_create_routine,
            agentic_super_app_command_update_routine,
            agentic_super_app_command_archive_routine,
            agentic_super_app_command_run_routine_now,
            agentic_super_app_query_routine_executions,
            agentic_super_app_query_plugin_catalog,
            agentic_super_app_query_plugin_connections,
            agentic_super_app_command_install_plugin,
            agentic_super_app_command_create_plugin_connection,
            agentic_super_app_command_update_plugin_connection,
            agentic_super_app_command_delete_plugin_connection,
            agentic_super_app_command_test_plugin_connection,
            agentic_super_app_query_agent_plugin_grants,
            agentic_super_app_command_set_agent_plugin_grant,
            agentic_super_app_command_dry_run_plugin,
            agentic_super_app_query_plugin_invocations,
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
            agentic_super_app_command_resume_code_dispatch,
            agentic_super_app_command_cancel_code_dispatch,
            agentic_super_app_command_open_code_dispatch_terminal,
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
            agentic_super_app_command_apply_code_pane_mutation,
            agentic_super_app_command_launch_code_pane_terminal,
            agentic_super_app_command_open_code_pane_preview,
            agentic_super_app_command_create_code_pane_thread,
            agentic_super_app_command_close_code_pane,
            agentic_super_app_query_code_terminal_snapshot,
            agentic_super_app_stream_code_terminal_events,
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
            agentic_super_app_command_mark_notification_read,
            agentic_super_app_command_mark_all_notifications_read,
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
fn agent_runtime_error(
    error: agentic_super_app_agent_runtime::AgenticSuperAppAgentRuntimeError,
) -> ApiError {
    match error {
        agentic_super_app_agent_runtime::AgenticSuperAppAgentRuntimeError::InvalidInput(
            message,
        ) => validation_error(message),
        agentic_super_app_agent_runtime::AgenticSuperAppAgentRuntimeError::Provider(_) => {
            application_error(
                "agent_provider_failed",
                "The Agent provider request failed. Check the provider account and try again.",
                RetryClass::AfterUserAction,
            )
        }
        agentic_super_app_agent_runtime::AgenticSuperAppAgentRuntimeError::Cancelled => {
            application_error(
                "agent_cancelled",
                "The Agent run was cancelled.",
                RetryClass::Safe,
            )
        }
        agentic_super_app_agent_runtime::AgenticSuperAppAgentRuntimeError::Artifact(_) => {
            application_error(
                "artifact_unavailable",
                "The Agent artifact could not be stored.",
                RetryClass::Safe,
            )
        }
        agentic_super_app_agent_runtime::AgenticSuperAppAgentRuntimeError::Store(error) => {
            application_error(
                "persistence_unavailable",
                error.to_string(),
                RetryClass::Safe,
            )
        }
    }
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

fn updater_error(error: impl ToString) -> ApiError {
    application_error("update_unavailable", error.to_string(), RetryClass::Safe)
}

fn release_error(error: release::AgenticSuperAppReleaseError) -> ApiError {
    application_error(
        "release_operation_failed",
        error.to_string(),
        RetryClass::Safe,
    )
}
