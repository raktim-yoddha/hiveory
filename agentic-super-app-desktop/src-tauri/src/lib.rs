#![allow(clippy::result_large_err)]

use agentic_super_app_artifact_store::{
    AgenticSuperAppArtifactError, AgenticSuperAppArtifactStore, AgenticSuperAppStoredAttachment,
};
use agentic_super_app_chat_domain::{estimate_context_tokens, validate_send_request};
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
    CommandEnvelope, DiagnosticSnapshot, JobState, ProviderDiagnosticRequest, ResponseEnvelope,
    RetryClass, SetActiveModeCommand, SharedEventEnvelope, AGENTIC_SUPER_APP_PROTOCOL_VERSION,
};
use agentic_super_app_secret_store::{
    AgenticSuperAppKeyringSecretStore, AgenticSuperAppSecretStoreHandle,
};
use agentic_super_app_tool_runtime::AgenticSuperAppAuditLog;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, RwLock},
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
}

impl AgenticSuperAppFoundation {
    async fn open(database_path: PathBuf, artifact_root: PathBuf) -> Result<Self, String> {
        let persistence = AgenticSuperAppPersistence::open(&database_path)
            .await
            .map_err(|error| error.to_string())?;
        let interrupted = persistence
            .interrupt_active_jobs()
            .await
            .map_err(|error| error.to_string())?;
        let chat = AgenticSuperAppChatStore::new(persistence.clone());
        let interrupted_chats = chat
            .interrupt_active_turns()
            .await
            .map_err(|error| error.to_string())?;
        let recovery_message = if interrupted > 0 || interrupted_chats > 0 {
            Some(format!(
                "Recovered {} interrupted operation(s) after restart.",
                interrupted + interrupted_chats
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
            let foundation = tauri::async_runtime::block_on(AgenticSuperAppFoundation::open(
                database_path,
                artifact_root,
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
