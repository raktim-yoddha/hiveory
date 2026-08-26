//! Versioned, renderer-safe contracts owned by the local application host.

use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::{Config, TS};

pub const AGENTIC_SUPER_APP_PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ApplicationMode {
    Agent,
    Code,
    Chat,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProtocolVersion {
    pub major: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommandEnvelope<T> {
    pub protocol: ProtocolVersion,
    pub request_id: String,
    pub payload: T,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResponseEnvelope<T> {
    pub protocol: ProtocolVersion,
    pub request_id: String,
    pub payload: T,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RetryClass {
    Never,
    Safe,
    AfterUserAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub retry: RetryClass,
    pub recovery_action: Option<String>,
    pub diagnostic_id: Option<String>,
    pub redacted_context: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    OpenAiResponses,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProviderAccountSummary {
    pub id: String,
    pub kind: ProviderKind,
    pub display_name: String,
    pub default_model: Option<String>,
    pub secret_configured: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProviderDiagnosticRequest {
    pub provider_account_id: String,
    pub model: String,
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct JobSummary {
    pub id: String,
    pub kind: String,
    pub state: JobState,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SharedEventKind {
    JobStateChanged,
    ProviderTextDelta,
    ProviderCompleted,
    ProviderFailed,
    NotificationCreated,
    RecoveryDetected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SharedEventEnvelope {
    pub sequence: u64,
    pub emitted_at_unix_ms: i64,
    pub kind: SharedEventKind,
    pub job_id: Option<String>,
    pub message: Option<String>,
    pub text_delta: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NotificationSummary {
    pub id: String,
    pub title: String,
    pub body: String,
    pub severity: String,
    pub read: bool,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DiagnosticSnapshot {
    pub providers: Vec<ProviderAccountSummary>,
    pub recent_jobs: Vec<JobSummary>,
    pub notifications: Vec<NotificationSummary>,
    pub recovery_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BootstrapSnapshot {
    pub protocol: ProtocolVersion,
    pub active_mode: ApplicationMode,
    pub product_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SetActiveModeCommand {
    pub mode: ApplicationMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BuildInformation {
    pub product_name: String,
    pub version: String,
    pub protocol: ProtocolVersion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ShellEvent {
    pub sequence: u64,
    pub active_mode: ApplicationMode,
}

pub fn current_protocol_version() -> ProtocolVersion {
    ProtocolVersion {
        major: AGENTIC_SUPER_APP_PROTOCOL_VERSION,
    }
}

pub fn export_typescript_bindings(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(path)?;
    let config = Config::new().with_out_dir(path);
    ApplicationMode::export_all(&config)?;
    ProtocolVersion::export_all(&config)?;
    CommandEnvelope::<SetActiveModeCommand>::export_all(&config)?;
    ResponseEnvelope::<BootstrapSnapshot>::export_all(&config)?;
    RetryClass::export_all(&config)?;
    ApiError::export_all(&config)?;
    ProviderKind::export_all(&config)?;
    ProviderAccountSummary::export_all(&config)?;
    ProviderDiagnosticRequest::export_all(&config)?;
    JobState::export_all(&config)?;
    JobSummary::export_all(&config)?;
    SharedEventKind::export_all(&config)?;
    SharedEventEnvelope::export_all(&config)?;
    NotificationSummary::export_all(&config)?;
    DiagnosticSnapshot::export_all(&config)?;
    BootstrapSnapshot::export_all(&config)?;
    SetActiveModeCommand::export_all(&config)?;
    BuildInformation::export_all(&config)?;
    ShellEvent::export_all(&config)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_version_is_stable() {
        assert_eq!(current_protocol_version().major, 1);
    }
}
