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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeWorkspaceTrust {
    Untrusted,
    Trusted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeWorkspaceCapability {
    ReadFiles,
    WriteFiles,
    ExecuteProcesses,
    ReadGit,
    OpenPreview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeWorkspaceSummary {
    pub id: String,
    pub host_id: String,
    pub display_name: String,
    pub root_path: String,
    pub repository_name: Option<String>,
    pub branch: Option<String>,
    pub is_git_repository: bool,
    pub trust: CodeWorkspaceTrust,
    pub capabilities: Vec<CodeWorkspaceCapability>,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeWorkspaceOpenRequest {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeWorkspaceTrustRequest {
    pub workspace_id: String,
    pub grant: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeWorkspaceQuery {
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeWorkspaceDetail {
    pub summary: CodeWorkspaceSummary,
    pub layout: CodePaneLayout,
    pub open_documents: Vec<CodeDocumentSummary>,
    pub terminals: Vec<CodeTerminalSummary>,
    pub previews: Vec<CodePreviewSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeSnapshot {
    pub workspaces: Vec<CodeWorkspaceSummary>,
    pub active_workspace_id: Option<String>,
    pub adapters: Vec<CodeAdapterSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeFileKind {
    File,
    Directory,
    Symlink,
    Binary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeFileNode {
    pub name: String,
    pub relative_path: String,
    pub kind: CodeFileKind,
    pub size: Option<u64>,
    pub language: Option<String>,
    pub modified_at_unix_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeFileTreeQuery {
    pub workspace_id: String,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeFileTree {
    pub workspace_id: String,
    pub directory: String,
    pub entries: Vec<CodeFileNode>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeReadFileRequest {
    pub workspace_id: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeSaveFileRequest {
    pub workspace_id: String,
    pub relative_path: String,
    pub content: String,
    pub expected_fingerprint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeDocumentSummary {
    pub relative_path: String,
    pub language: Option<String>,
    pub last_fingerprint: Option<String>,
    pub last_opened_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeDocument {
    pub workspace_id: String,
    pub relative_path: String,
    pub content: String,
    pub language: Option<String>,
    pub fingerprint: String,
    pub bytes: u64,
    pub read_only: bool,
    pub binary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodePaneKind {
    Terminal,
    CodingAgent,
    Editor,
    Diff,
    Preview,
    Problems,
    Empty,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodePaneOrientation {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodePaneNode {
    pub pane_id: String,
    pub parent_id: Option<String>,
    pub kind: CodePaneKind,
    pub orientation: Option<CodePaneOrientation>,
    pub ratio_percent: Option<u8>,
    pub children: Vec<String>,
    pub resource_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodePaneLayout {
    pub workspace_id: String,
    pub version: u32,
    pub root_id: String,
    pub nodes: Vec<CodePaneNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeSaveLayoutRequest {
    pub workspace_id: String,
    pub layout: CodePaneLayout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeTerminalKind {
    Shell,
    CodingAgent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeTerminalState {
    Starting,
    Running,
    Exited,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTerminalSummary {
    pub id: String,
    pub workspace_id: String,
    pub kind: CodeTerminalKind,
    pub state: CodeTerminalState,
    pub pid: Option<u32>,
    pub adapter_id: Option<String>,
    pub session_id: Option<String>,
    pub exit_code: Option<i32>,
    pub started_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTerminalStartRequest {
    pub workspace_id: String,
    pub kind: CodeTerminalKind,
    pub cols: u16,
    pub rows: u16,
    pub adapter_id: Option<String>,
    pub model: Option<String>,
    pub resume_session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTerminalInputRequest {
    pub terminal_id: String,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTerminalResizeRequest {
    pub terminal_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTerminalStopRequest {
    pub terminal_id: String,
    pub force: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeTerminalEventKind {
    Started,
    Output,
    Exited,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTerminalEvent {
    pub terminal_id: String,
    pub kind: CodeTerminalEventKind,
    pub data_base64: Option<String>,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
    pub emitted_at_unix_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeAdapterCapability {
    Resume,
    ModelSelection,
    ReasoningEffort,
    PermissionModes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeAdapterSummary {
    pub id: String,
    pub display_name: String,
    pub executable: String,
    pub detected: bool,
    pub authenticated: bool,
    pub capabilities: Vec<CodeAdapterCapability>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeGitStatusRequest {
    pub workspace_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeGitFileStatus {
    pub relative_path: String,
    pub status: String,
    pub staged: bool,
    pub conflict: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeGitStatus {
    pub workspace_id: String,
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub files: Vec<CodeGitFileStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeGitDiffRequest {
    pub workspace_id: String,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeGitDiff {
    pub workspace_id: String,
    pub relative_path: Option<String>,
    pub content: String,
    pub binary: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodePreviewState {
    Open,
    Closed,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodePreviewRequest {
    pub workspace_id: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodePreviewSummary {
    pub id: String,
    pub workspace_id: String,
    pub url: String,
    pub origin: String,
    pub state: CodePreviewState,
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
    CodeWorkspaceTrust::export_all(&config)?;
    CodeWorkspaceCapability::export_all(&config)?;
    CodeWorkspaceSummary::export_all(&config)?;
    CodeWorkspaceOpenRequest::export_all(&config)?;
    CodeWorkspaceTrustRequest::export_all(&config)?;
    CodeWorkspaceQuery::export_all(&config)?;
    CodeWorkspaceDetail::export_all(&config)?;
    CodeSnapshot::export_all(&config)?;
    CodeFileKind::export_all(&config)?;
    CodeFileNode::export_all(&config)?;
    CodeFileTreeQuery::export_all(&config)?;
    CodeFileTree::export_all(&config)?;
    CodeReadFileRequest::export_all(&config)?;
    CodeSaveFileRequest::export_all(&config)?;
    CodeDocumentSummary::export_all(&config)?;
    CodeDocument::export_all(&config)?;
    CodePaneKind::export_all(&config)?;
    CodePaneOrientation::export_all(&config)?;
    CodePaneNode::export_all(&config)?;
    CodePaneLayout::export_all(&config)?;
    CodeSaveLayoutRequest::export_all(&config)?;
    CodeTerminalKind::export_all(&config)?;
    CodeTerminalState::export_all(&config)?;
    CodeTerminalSummary::export_all(&config)?;
    CodeTerminalStartRequest::export_all(&config)?;
    CodeTerminalInputRequest::export_all(&config)?;
    CodeTerminalResizeRequest::export_all(&config)?;
    CodeTerminalStopRequest::export_all(&config)?;
    CodeTerminalEventKind::export_all(&config)?;
    CodeTerminalEvent::export_all(&config)?;
    CodeAdapterCapability::export_all(&config)?;
    CodeAdapterSummary::export_all(&config)?;
    CodeGitStatusRequest::export_all(&config)?;
    CodeGitFileStatus::export_all(&config)?;
    CodeGitStatus::export_all(&config)?;
    CodeGitDiffRequest::export_all(&config)?;
    CodeGitDiff::export_all(&config)?;
    CodePreviewState::export_all(&config)?;
    CodePreviewRequest::export_all(&config)?;
    CodePreviewSummary::export_all(&config)?;
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
