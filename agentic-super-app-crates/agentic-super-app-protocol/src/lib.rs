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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ChatReasoningEffort {
    Auto,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ChatTurnState {
    Queued,
    Streaming,
    CancelRequested,
    Cancelled,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatAttachmentSummary {
    pub id: String,
    pub display_name: String,
    pub mime_type: String,
    pub bytes: i64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChatMessagePart {
    Text {
        text: String,
    },
    ReasoningSummary {
        text: String,
    },
    Status {
        code: String,
        text: String,
    },
    Error {
        code: String,
        message: String,
    },
    Attachment {
        attachment: ChatAttachmentSummary,
    },
    Image {
        attachment: ChatAttachmentSummary,
    },
    Citation {
        url: String,
        title: Option<String>,
    },
    Usage {
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    },
    ToolCall {
        call_id: String,
        name: String,
        arguments_json: String,
    },
    ToolResult {
        call_id: String,
        result: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ChatMessageRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatMessage {
    pub id: String,
    pub branch_id: String,
    pub role: ChatMessageRole,
    pub parts: Vec<ChatMessagePart>,
    pub created_at_unix_ms: i64,
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatBranchSummary {
    pub id: String,
    pub parent_branch_id: Option<String>,
    pub forked_after_message_id: Option<String>,
    pub label: String,
    pub created_at_unix_ms: i64,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatTurnSummary {
    pub id: String,
    pub message_id: String,
    pub assistant_message_id: String,
    pub branch_id: String,
    pub provider_account_id: String,
    pub model: String,
    pub reasoning_effort: ChatReasoningEffort,
    pub state: ChatTurnState,
    pub job_id: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatConversationSummary {
    pub id: String,
    pub title: String,
    pub active_branch_id: String,
    pub pinned: bool,
    pub archived: bool,
    pub updated_at_unix_ms: i64,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatConversationDetail {
    pub id: String,
    pub title: String,
    pub active_branch_id: String,
    pub pinned: bool,
    pub archived: bool,
    pub branches: Vec<ChatBranchSummary>,
    pub messages: Vec<ChatMessage>,
    pub turns: Vec<ChatTurnSummary>,
    pub draft: String,
    pub event_cursor: i64,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatSidebarPage {
    pub conversations: Vec<ChatConversationSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatEventEnvelope {
    pub global_sequence: i64,
    pub aggregate_sequence: i64,
    pub conversation_id: String,
    pub branch_id: Option<String>,
    pub turn_id: Option<String>,
    pub message_id: Option<String>,
    pub kind: String,
    pub text_delta: Option<String>,
    pub message: Option<String>,
    pub emitted_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatProviderPart {
    pub kind: String,
    pub text: Option<String>,
    pub data_url: Option<String>,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatProviderMessage {
    pub role: ChatMessageRole,
    pub parts: Vec<ChatProviderPart>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatModelTurnRequest {
    pub model: String,
    pub reasoning_effort: ChatReasoningEffort,
    pub messages: Vec<ChatProviderMessage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ChatProviderStreamEventKind {
    TextDelta,
    ReasoningSummary,
    Usage,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatProviderStreamEvent {
    pub provider_sequence: i64,
    pub kind: ChatProviderStreamEventKind,
    pub text: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatCreateRequest {
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatMetadataRequest {
    pub conversation_id: String,
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatDeleteRequest {
    pub conversation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatDraftRequest {
    pub conversation_id: String,
    pub draft: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatAttachmentImportRequest {
    pub conversation_id: String,
    pub message_id: Option<String>,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatSendRequest {
    pub conversation_id: String,
    pub branch_id: String,
    pub text: String,
    pub attachment_ids: Vec<String>,
    pub provider_account_id: String,
    pub model: String,
    pub reasoning_effort: ChatReasoningEffort,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatTurnRequest {
    pub conversation_id: String,
    pub turn_id: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<ChatReasoningEffort>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatEditRequest {
    pub conversation_id: String,
    pub message_id: String,
    pub text: String,
    pub provider_account_id: String,
    pub model: String,
    pub reasoning_effort: ChatReasoningEffort,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatBranchRequest {
    pub conversation_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatDeleteAttachmentRequest {
    pub conversation_id: String,
    pub message_id: String,
    pub attachment_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatExportRequest {
    pub conversation_id: String,
    pub branch_id: String,
    pub destination: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatSidebarQuery {
    pub search: Option<String>,
    pub archived: bool,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatEventsQuery {
    pub conversation_id: String,
    pub after_global_sequence: i64,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatStreamRequest {
    pub after_global_sequence: i64,
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
    ChatReasoningEffort::export_all(&config)?;
    ChatTurnState::export_all(&config)?;
    ChatAttachmentSummary::export_all(&config)?;
    ChatMessagePart::export_all(&config)?;
    ChatMessageRole::export_all(&config)?;
    ChatMessage::export_all(&config)?;
    ChatBranchSummary::export_all(&config)?;
    ChatTurnSummary::export_all(&config)?;
    ChatConversationSummary::export_all(&config)?;
    ChatConversationDetail::export_all(&config)?;
    ChatSidebarPage::export_all(&config)?;
    ChatEventEnvelope::export_all(&config)?;
    ChatProviderPart::export_all(&config)?;
    ChatProviderMessage::export_all(&config)?;
    ChatModelTurnRequest::export_all(&config)?;
    ChatProviderStreamEventKind::export_all(&config)?;
    ChatProviderStreamEvent::export_all(&config)?;
    ChatCreateRequest::export_all(&config)?;
    ChatMetadataRequest::export_all(&config)?;
    ChatDeleteRequest::export_all(&config)?;
    ChatDraftRequest::export_all(&config)?;
    ChatAttachmentImportRequest::export_all(&config)?;
    ChatSendRequest::export_all(&config)?;
    ChatTurnRequest::export_all(&config)?;
    ChatEditRequest::export_all(&config)?;
    ChatBranchRequest::export_all(&config)?;
    ChatDeleteAttachmentRequest::export_all(&config)?;
    ChatExportRequest::export_all(&config)?;
    ChatSidebarQuery::export_all(&config)?;
    ChatEventsQuery::export_all(&config)?;
    ChatStreamRequest::export_all(&config)?;
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
