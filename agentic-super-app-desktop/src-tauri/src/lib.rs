use agentic_super_app_job_runtime::AgenticSuperAppJobRuntime;
use agentic_super_app_model_gateway::{
    AgenticSuperAppModelProvider, AgenticSuperAppOpenAiResponsesProvider,
    AgenticSuperAppProviderError,
};
use agentic_super_app_notification_service::AgenticSuperAppNotificationService;
use agentic_super_app_persistence::{
    AgenticSuperAppPersistence, AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID,
};
use agentic_super_app_protocol::{
    current_protocol_version, ApiError, ApplicationMode, BootstrapSnapshot, BuildInformation,
    DiagnosticSnapshot, JobState, ProviderDiagnosticRequest, RetryClass, SetActiveModeCommand,
    SharedEventEnvelope,
};
use agentic_super_app_secret_store::{
    AgenticSuperAppKeyringSecretStore, AgenticSuperAppSecretStoreHandle,
};
use agentic_super_app_tool_runtime::AgenticSuperAppAuditLog;
use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};
use tauri::{ipc::Channel, Manager, State};
use tauri_plugin_notification::NotificationExt;

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
    recovery_message: Arc<RwLock<Option<String>>>,
}

impl AgenticSuperAppFoundation {
    async fn open(database_path: PathBuf) -> Result<Self, String> {
        let persistence = AgenticSuperAppPersistence::open(&database_path)
            .await
            .map_err(|error| error.to_string())?;
        let interrupted = persistence
            .interrupt_active_jobs()
            .await
            .map_err(|error| error.to_string())?;
        let recovery_message = if interrupted > 0 {
            Some(format!(
                "Recovered {interrupted} interrupted job(s) after restart."
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
        Ok(Self {
            persistence,
            secrets,
            provider,
            jobs,
            notifications,
            audit,
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
        .setup(|app| {
            let database_path = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("agentic-super-app.sqlite3");
            let foundation =
                tauri::async_runtime::block_on(AgenticSuperAppFoundation::open(database_path))
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
