//! Versioned, renderer-safe contracts owned by the local application host.

use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::{Config, TS};

pub const AGENTIC_SUPER_APP_PROTOCOL_VERSION: u16 = 2;
pub const CODE_ORCHESTRATION_DEFAULT_COORDINATOR_ID: &str = "local-coordinator";
pub const CODE_ORCHESTRATION_DEFAULT_ADAPTER_ID: &str = "codex-cli";

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
    #[serde(default)]
    pub native_notification: bool,
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
    Thread,
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
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodePaneLayout {
    pub workspace_id: String,
    pub version: u32,
    pub root_id: String,
    pub nodes: Vec<CodePaneNode>,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub focused_pane_id: Option<String>,
    #[serde(default)]
    pub maximized_pane_id: Option<String>,
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
pub enum CodePanePlacement {
    Center,
    Left,
    Right,
    Top,
    Bottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodePanePreset {
    EqualColumns,
    EqualRows,
    MainLeft,
    MainTop,
    Grid,
    Tidy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CodePaneMutation {
    Split {
        pane_id: String,
        placement: CodePanePlacement,
    },
    Rename {
        pane_id: String,
        title: String,
    },
    Move {
        pane_id: String,
        target_pane_id: String,
        placement: CodePanePlacement,
    },
    Resize {
        split_id: String,
        ratio_percent: u8,
    },
    Focus {
        pane_id: String,
    },
    Maximize {
        pane_id: Option<String>,
    },
    ApplyPreset {
        preset: CodePanePreset,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodePaneMutationRequest {
    pub workspace_id: String,
    pub expected_revision: u64,
    pub mutation: CodePaneMutation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodePaneMutationResult {
    pub layout: CodePaneLayout,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LaunchCodePaneTerminalRequest {
    pub workspace_id: String,
    pub pane_id: String,
    pub expected_revision: u64,
    pub kind: CodeTerminalKind,
    pub adapter_id: Option<String>,
    pub model: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LaunchCodePaneTerminalResult {
    pub layout: CodePaneLayout,
    pub terminal: CodeTerminalSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OpenCodePanePreviewRequest {
    pub workspace_id: String,
    pub pane_id: String,
    pub expected_revision: u64,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OpenCodePanePreviewResult {
    pub layout: CodePaneLayout,
    pub preview: CodePreviewSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateCodePaneThreadRequest {
    pub workspace_id: String,
    pub pane_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateCodePaneThreadResult {
    pub layout: CodePaneLayout,
    pub conversation: ChatConversationDetail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CloseCodePaneRequest {
    pub workspace_id: String,
    pub pane_id: String,
    pub expected_revision: u64,
    pub terminate_running_resource: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTerminalSnapshotQuery {
    pub terminal_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTerminalSnapshot {
    pub summary: CodeTerminalSummary,
    pub cols: u16,
    pub rows: u16,
    pub output_base64: String,
    pub sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTerminalSubscribeRequest {
    pub terminal_id: String,
    pub after_sequence: u64,
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
/// Terminal input is transported as UTF-8 encoded standard base64 so control
/// bytes and pasted Unicode text cross the JSON/Tauri boundary without loss.
pub struct CodeTerminalInputRequest {
    pub terminal_id: String,
    pub data_base64: String,
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
/// A terminal event carries a monotonic per-terminal sequence so clients can
/// close snapshot/stream races and recover from a lagged broadcast subscriber.
pub struct CodeTerminalEvent {
    pub terminal_id: String,
    pub sequence: u64,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeRunState {
    Draft,
    Ready,
    Running,
    Paused,
    Blocked,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeTaskState {
    Draft,
    Blocked,
    Ready,
    Preparing,
    Running,
    AwaitingInput,
    AwaitingReview,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeDispatchState {
    Preparing,
    Running,
    AwaitingInput,
    Checkpointing,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
    Stale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeReviewPolicy {
    Manual,
    Automatic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeReviewDecision {
    Accept,
    RequestChanges,
    Reject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeCheckpointKind {
    Source,
    Result,
    Integration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeCheckpointState {
    Creating,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeManagedWorktreeState {
    Provisioning,
    Ready,
    CleanupPending,
    Removed,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeOrchestrationMessageKind {
    Status,
    Heartbeat,
    Question,
    Answer,
    Escalation,
    Progress,
    Completion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CodeOrchestrationEventOrigin {
    Host,
    Worker,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeRunSummary {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub objective: String,
    pub model: Option<String>,
    pub coordinator_id: String,
    pub adapter_id: String,
    pub state: CodeRunState,
    pub review_policy: CodeReviewPolicy,
    pub concurrency_limit: u8,
    pub host_concurrency_cap: u8,
    pub task_count: u32,
    pub completed_tasks: u32,
    pub active_dispatches: u32,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTask {
    pub id: String,
    pub run_id: String,
    pub client_id: String,
    pub title: String,
    pub specification: String,
    pub state: CodeTaskState,
    pub position: u32,
    pub active_dispatch_id: Option<String>,
    pub latest_checkpoint_id: Option<String>,
    pub base_checkpoint_id: Option<String>,
    pub attempt: u32,
    pub error: Option<String>,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTaskDependency {
    pub run_id: String,
    pub task_id: String,
    pub depends_on_task_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeDispatch {
    pub id: String,
    pub run_id: String,
    pub task_id: String,
    pub attempt: u32,
    pub state: CodeDispatchState,
    pub adapter_id: String,
    pub lease_generation: u64,
    pub session_id: Option<String>,
    pub pid: Option<u32>,
    pub worktree_id: Option<String>,
    pub checkpoint_id: Option<String>,
    pub last_heartbeat_at_unix_ms: Option<i64>,
    pub terminal_id: Option<String>,
    pub cancel_requested_at_unix_ms: Option<i64>,
    pub started_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub error: Option<String>,
    pub result_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeManagedWorktree {
    pub id: String,
    pub run_id: String,
    pub task_id: String,
    pub dispatch_id: String,
    pub path: String,
    pub branch: String,
    pub base_checkpoint_id: Option<String>,
    pub state: CodeManagedWorktreeState,
    pub dirty: bool,
    pub locked: bool,
    pub error: Option<String>,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeCheckpoint {
    pub id: String,
    pub run_id: String,
    pub task_id: Option<String>,
    pub dispatch_id: Option<String>,
    pub kind: CodeCheckpointKind,
    pub state: CodeCheckpointState,
    pub ref_name: String,
    pub commit_oid: Option<String>,
    pub parent_checkpoint_id: Option<String>,
    pub summary: String,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeReview {
    pub id: String,
    pub run_id: String,
    pub task_id: String,
    pub checkpoint_id: String,
    pub decision: CodeReviewDecision,
    pub feedback: Option<String>,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeQuestion {
    pub id: String,
    pub run_id: String,
    pub task_id: String,
    pub dispatch_id: String,
    pub prompt: String,
    pub answer: Option<String>,
    pub answered: bool,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeOrchestrationMessage {
    pub id: String,
    pub run_id: String,
    pub task_id: Option<String>,
    pub dispatch_id: Option<String>,
    pub kind: CodeOrchestrationMessageKind,
    pub question_id: Option<String>,
    pub payload: String,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeOrchestrationEventEnvelope {
    pub run_id: String,
    pub sequence: u64,
    pub event_id: String,
    pub task_id: Option<String>,
    pub dispatch_id: Option<String>,
    pub lease_generation: u64,
    pub kind: CodeOrchestrationMessageKind,
    pub payload: String,
    pub accepted: bool,
    pub origin: CodeOrchestrationEventOrigin,
    pub worker_sequence: Option<u64>,
    pub nonce: Option<String>,
    pub emitted_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeDagProposalTask {
    pub client_id: String,
    pub title: String,
    pub specification: String,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeDagProposal {
    pub objective: String,
    pub tasks: Vec<CodeDagProposalTask>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeRunDetail {
    pub summary: CodeRunSummary,
    pub tasks: Vec<CodeTask>,
    pub dependencies: Vec<CodeTaskDependency>,
    pub dispatches: Vec<CodeDispatch>,
    pub worktrees: Vec<CodeManagedWorktree>,
    pub checkpoints: Vec<CodeCheckpoint>,
    pub reviews: Vec<CodeReview>,
    pub questions: Vec<CodeQuestion>,
    pub messages: Vec<CodeOrchestrationMessage>,
    pub events: Vec<CodeOrchestrationEventEnvelope>,
    pub event_cursor: u64,
    pub proposal: Option<CodeDagProposal>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeRunCreateRequest {
    pub workspace_id: String,
    pub title: String,
    pub objective: String,
    pub review_policy: CodeReviewPolicy,
    pub concurrency_limit: Option<u8>,
    pub model: Option<String>,
    #[serde(default)]
    pub coordinator_id: Option<String>,
    #[serde(default)]
    pub adapter_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeRunUpdateRequest {
    pub run_id: String,
    pub title: String,
    pub objective: String,
    pub review_policy: CodeReviewPolicy,
    pub concurrency_limit: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTaskCreateRequest {
    pub run_id: String,
    pub client_id: Option<String>,
    pub title: String,
    pub specification: String,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTaskUpdateRequest {
    pub run_id: String,
    pub task_id: String,
    pub title: String,
    pub specification: String,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTaskDeleteRequest {
    pub run_id: String,
    pub task_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeDagProposalRequest {
    pub workspace_id: String,
    pub objective: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeDagProposalAcceptRequest {
    pub run_id: String,
    pub proposal: CodeDagProposal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeRunRequest {
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeDispatchResumeRequest {
    pub run_id: String,
    pub task_id: String,
    pub dispatch_id: String,
    pub lease_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeDispatchCancelRequest {
    pub run_id: String,
    pub task_id: String,
    pub dispatch_id: String,
    pub lease_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeDispatchTerminalRequest {
    pub run_id: String,
    pub dispatch_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeQuestionAnswerRequest {
    pub run_id: String,
    pub task_id: String,
    pub dispatch_id: String,
    pub lease_generation: u64,
    pub answer: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeTaskRetryRequest {
    pub run_id: String,
    pub task_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeReviewRequest {
    pub run_id: String,
    pub task_id: String,
    pub checkpoint_id: String,
    pub decision: CodeReviewDecision,
    pub feedback: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeCleanupPreviewRequest {
    pub run_id: String,
    pub worktree_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeCleanupPreview {
    pub worktree_id: String,
    pub path: String,
    pub branch: String,
    pub dirty_files: Vec<String>,
    pub locked: bool,
    pub can_remove: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeCleanupConfirmRequest {
    pub run_id: String,
    pub worktree_id: String,
    pub confirmation: String,
    pub force: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeOrchestrationEventsQuery {
    pub run_id: String,
    pub after_sequence: u64,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodeCheckpointDiffRequest {
    pub run_id: String,
    pub checkpoint_id: String,
    pub compare_to_checkpoint_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentApprovalPolicy {
    AlwaysAsk,
    AskForMutations,
    AllowWithinScope,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentMemoryPolicy {
    Disabled,
    ExplicitOnly,
    IncludeSummaries,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunState {
    Queued,
    Preparing,
    Running,
    AwaitingApproval,
    AwaitingInput,
    Interrupted,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolRisk {
    ReadOnly,
    InternalMutation,
    FilesystemMutation,
    ExternallyVisible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolCallState {
    Proposed,
    AwaitingApproval,
    Approved,
    Executing,
    Completed,
    Denied,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentApprovalDecision {
    Approve,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentMemoryClass {
    AgentKnowledge,
    UserPreference,
    RunSummary,
    SkillObservation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentSkillOrigin {
    Builtin,
    ApplicationData,
    ConfiguredDirectory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentArtifactKind {
    Text,
    Json,
    Markdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentEventKind {
    RunStateChanged,
    AssistantTextDelta,
    ReasoningSummary,
    ToolCallProposed,
    ToolCallStarted,
    ToolCallCompleted,
    ToolCallFailed,
    ApprovalRequested,
    ApprovalResolved,
    InputRequested,
    SkillLoaded,
    MemoryRetrieved,
    ArtifactCreated,
    ChildRunCreated,
    CompactionCreated,
    UsageRecorded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentRuntimeLimits {
    pub max_steps: u32,
    pub max_tool_calls: u32,
    pub max_duration_seconds: u32,
    pub max_context_tokens: u32,
    pub max_subagent_depth: u8,
    pub max_concurrent_subagents: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub avatar_color: String,
    pub provider_account_id: String,
    pub model: String,
    pub version: u32,
    pub archived: bool,
    pub active_run_state: Option<AgentRunState>,
    pub enabled_skill_count: u32,
    pub enabled_tool_count: u32,
    pub folder_grant_count: u32,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentFolderGrant {
    pub id: String,
    pub agent_id: String,
    pub display_name: String,
    pub root_path: String,
    pub read: bool,
    pub write: bool,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema_json: String,
    pub risk: AgentToolRisk,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentSkillSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub origin: AgentSkillOrigin,
    pub source_path: String,
    pub triggers: Vec<String>,
    pub permissions: Vec<String>,
    pub enabled: bool,
    pub valid: bool,
    pub validation_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentSkillConflict {
    pub trigger: String,
    pub skill_ids: Vec<String>,
    pub selected_skill_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentMemorySummary {
    pub id: String,
    pub agent_id: String,
    pub class: AgentMemoryClass,
    pub content: String,
    pub source_type: String,
    pub source_id: Option<String>,
    pub enabled: bool,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentArtifactSummary {
    pub id: String,
    pub run_id: String,
    pub name: String,
    pub kind: AgentArtifactKind,
    pub relative_path: String,
    pub bytes: u64,
    pub sha256: String,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentToolCallSummary {
    pub id: String,
    pub run_id: String,
    pub call_id: String,
    pub name: String,
    pub arguments_json: String,
    pub risk: AgentToolRisk,
    pub state: AgentToolCallState,
    pub approval_id: Option<String>,
    pub result_preview: Option<String>,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentApprovalSummary {
    pub id: String,
    pub run_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub target: String,
    pub arguments_json: String,
    pub fingerprint: String,
    pub reversible: bool,
    pub state: String,
    pub created_at_unix_ms: i64,
    pub resolved_at_unix_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentRunSummary {
    pub id: String,
    pub agent_id: String,
    pub agent_version: u32,
    pub conversation_id: String,
    pub state: AgentRunState,
    pub prompt_preview: String,
    pub background: bool,
    pub step_count: u32,
    pub tool_call_count: u32,
    pub pending_approval_id: Option<String>,
    pub lease_generation: u64,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub error: Option<String>,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub completed_at_unix_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentMessage {
    pub id: String,
    pub run_id: String,
    pub role: String,
    pub kind: String,
    pub content: String,
    pub tool_call_id: Option<String>,
    pub created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentRunDetail {
    pub summary: AgentRunSummary,
    pub messages: Vec<AgentMessage>,
    pub tool_calls: Vec<AgentToolCallSummary>,
    pub approvals: Vec<AgentApprovalSummary>,
    pub skills: Vec<AgentSkillSummary>,
    pub memories: Vec<AgentMemorySummary>,
    pub artifacts: Vec<AgentArtifactSummary>,
    pub child_runs: Vec<AgentRunSummary>,
    pub event_cursor: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentDetail {
    pub summary: AgentSummary,
    pub operating_brief: String,
    pub system_instructions: String,
    pub approval_policy: AgentApprovalPolicy,
    pub memory_policy: AgentMemoryPolicy,
    pub runtime_limits: AgentRuntimeLimits,
    pub folders: Vec<AgentFolderGrant>,
    pub tools: Vec<AgentToolDefinition>,
    pub skills: Vec<AgentSkillSummary>,
    pub conflicts: Vec<AgentSkillConflict>,
    pub recent_runs: Vec<AgentRunSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentDashboard {
    pub agents: Vec<AgentSummary>,
    pub active_runs: Vec<AgentRunSummary>,
    pub pending_approvals: Vec<AgentApprovalSummary>,
    pub recent_runs: Vec<AgentRunSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentCreateRequest {
    pub name: String,
    pub description: String,
    pub operating_brief: String,
    pub avatar_color: String,
    pub provider_account_id: String,
    pub model: String,
    pub system_instructions: String,
    pub approval_policy: AgentApprovalPolicy,
    pub memory_policy: AgentMemoryPolicy,
    pub runtime_limits: AgentRuntimeLimits,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentUpdateRequest {
    pub agent_id: String,
    pub name: String,
    pub description: String,
    pub operating_brief: String,
    pub avatar_color: String,
    pub provider_account_id: String,
    pub model: String,
    pub system_instructions: String,
    pub approval_policy: AgentApprovalPolicy,
    pub memory_policy: AgentMemoryPolicy,
    pub runtime_limits: AgentRuntimeLimits,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentIdRequest {
    pub agent_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentFolderGrantRequest {
    pub agent_id: String,
    pub path: String,
    pub read: bool,
    pub write: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentFolderGrantDeleteRequest {
    pub agent_id: String,
    pub grant_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentSkillToggleRequest {
    pub agent_id: String,
    pub skill_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentSkillConflictResolutionRequest {
    pub agent_id: String,
    pub trigger: String,
    pub skill_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentMemoryQuery {
    pub agent_id: String,
    pub search: Option<String>,
    pub class: Option<AgentMemoryClass>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentMemoryMutationRequest {
    pub agent_id: String,
    pub memory_id: Option<String>,
    pub class: AgentMemoryClass,
    pub content: String,
    pub source_type: String,
    pub source_id: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentMemoryDeleteRequest {
    pub agent_id: String,
    pub memory_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentRunStartRequest {
    pub agent_id: String,
    pub conversation_id: Option<String>,
    pub prompt: String,
    pub background: bool,
    #[serde(default)]
    pub routine_execution_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentRunControlRequest {
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentApprovalDecisionRequest {
    pub run_id: String,
    pub approval_id: String,
    pub fingerprint: String,
    pub decision: AgentApprovalDecision,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentInputRequest {
    pub run_id: String,
    pub answer: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentRunsQuery {
    pub agent_id: Option<String>,
    pub state: Option<AgentRunState>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentEventsQuery {
    pub run_id: String,
    pub after_sequence: u64,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentEventEnvelope {
    pub run_id: String,
    pub sequence: u64,
    pub event_id: String,
    pub kind: AgentEventKind,
    pub step: u32,
    pub tool_call_id: Option<String>,
    pub payload: String,
    pub emitted_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentSkillCatalog {
    pub skills: Vec<AgentSkillSummary>,
    pub conflicts: Vec<AgentSkillConflict>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentExportRequest {
    pub agent_id: String,
    pub destination: String,
    pub include_memory: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentConversationSummary {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub message_count: u32,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentConversationDetail {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub messages: Vec<AgentMessage>,
    pub runs: Vec<AgentRunSummary>,
    pub draft: String,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentConversationQuery {
    pub agent_id: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentConversationCreateRequest {
    pub agent_id: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentConversationMessageRequest {
    pub agent_id: String,
    pub conversation_id: Option<String>,
    pub prompt: String,
    pub background: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentModelTurnRequest {
    pub model: String,
    pub system_instructions: String,
    pub input_items_json: Vec<String>,
    pub tools: Vec<AgentToolDefinition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentProviderStreamEventKind {
    TextDelta,
    ReasoningSummary,
    FunctionCall,
    OutputItem,
    Usage,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentProviderStreamEvent {
    pub provider_sequence: i64,
    pub kind: AgentProviderStreamEventKind,
    pub text: Option<String>,
    pub call_id: Option<String>,
    pub name: Option<String>,
    pub arguments_json: Option<String>,
    pub item_json: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentProviderToolOutput {
    pub call_id: String,
    pub output_json: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RoutineCatchUpPolicy {
    Skip,
    RunLatest,
    RunAllBounded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RoutineConcurrencyPolicy {
    Skip,
    QueueOne,
    ParallelBounded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoutineSchedule {
    pub expression: String,
    pub timezone: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RoutineDeliveryDestination {
    InApp,
    InAppAndNative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RoutineExecutionState {
    Queued,
    Running,
    AwaitingApproval,
    Completed,
    Failed,
    Skipped,
    Interrupted,
    UnknownOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoutineSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub agent_id: String,
    pub agent_name: String,
    pub schedule: RoutineSchedule,
    pub enabled: bool,
    pub archived: bool,
    pub catch_up: RoutineCatchUpPolicy,
    pub concurrency: RoutineConcurrencyPolicy,
    pub delivery: RoutineDeliveryDestination,
    pub next_run_unix_ms: Option<i64>,
    pub last_run_unix_ms: Option<i64>,
    pub last_execution_state: Option<RoutineExecutionState>,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoutineExecution {
    pub id: String,
    pub routine_id: String,
    pub run_id: Option<String>,
    pub occurrence_key: String,
    pub scheduled_for_unix_ms: i64,
    pub state: RoutineExecutionState,
    pub folder_grant_ids: Vec<String>,
    pub plugin_tool_names: Vec<String>,
    pub error: Option<String>,
    pub report: Option<String>,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub started_at_unix_ms: Option<i64>,
    pub completed_at_unix_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoutineDetail {
    pub summary: RoutineSummary,
    pub prompt_template: String,
    pub folder_grant_ids: Vec<String>,
    pub plugin_tool_names: Vec<String>,
    pub max_duration_seconds: u32,
    pub max_tool_calls: u32,
    pub approval_timeout_seconds: u32,
    pub executions: Vec<RoutineExecution>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoutineCreateRequest {
    pub name: String,
    pub description: String,
    pub agent_id: String,
    pub prompt_template: String,
    pub schedule: RoutineSchedule,
    pub enabled: bool,
    pub catch_up: RoutineCatchUpPolicy,
    pub concurrency: RoutineConcurrencyPolicy,
    pub delivery: RoutineDeliveryDestination,
    pub folder_grant_ids: Vec<String>,
    pub plugin_tool_names: Vec<String>,
    pub max_duration_seconds: u32,
    pub max_tool_calls: u32,
    pub approval_timeout_seconds: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoutineUpdateRequest {
    pub routine_id: String,
    pub name: String,
    pub description: String,
    pub agent_id: String,
    pub prompt_template: String,
    pub schedule: RoutineSchedule,
    pub enabled: bool,
    pub catch_up: RoutineCatchUpPolicy,
    pub concurrency: RoutineConcurrencyPolicy,
    pub delivery: RoutineDeliveryDestination,
    pub folder_grant_ids: Vec<String>,
    pub plugin_tool_names: Vec<String>,
    pub max_duration_seconds: u32,
    pub max_tool_calls: u32,
    pub approval_timeout_seconds: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoutineQuery {
    pub enabled: Option<bool>,
    pub include_archived: bool,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoutineIdRequest {
    pub routine_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoutineExecutionsQuery {
    pub routine_id: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PluginAdapterKind {
    JsonHttpGet,
    JsonHttpPost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PluginConnectionKind {
    None,
    ApiKeyHeader,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginPermission {
    pub capability: String,
    pub explanation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema_json: String,
    pub output_schema_json: String,
    pub risk: AgentToolRisk,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginManifest {
    pub id: String,
    pub publisher: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub adapter: PluginAdapterKind,
    pub tools: Vec<PluginToolDefinition>,
    pub permissions: Vec<PluginPermission>,
    pub allowed_hosts: Vec<String>,
    pub connection_kind: PluginConnectionKind,
    pub supports_dry_run: bool,
    pub content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginCatalogEntry {
    pub manifest: PluginManifest,
    pub installed: bool,
    pub enabled: bool,
    pub connection_count: u32,
    pub assigned_agent_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginConnectionSummary {
    pub id: String,
    pub plugin_id: String,
    pub name: String,
    pub origin: String,
    pub kind: PluginConnectionKind,
    pub api_key_header: Option<String>,
    pub secret_configured: bool,
    pub validated_at_unix_ms: Option<i64>,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginInstallRequest {
    pub plugin_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginConnectionCreateRequest {
    pub plugin_id: String,
    pub name: String,
    pub origin: String,
    pub kind: PluginConnectionKind,
    pub api_key_header: Option<String>,
    /// Accepted only on input and never returned by any query.
    pub secret_value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginConnectionUpdateRequest {
    pub connection_id: String,
    pub name: String,
    pub origin: String,
    pub api_key_header: Option<String>,
    /// Accepted only on input and never returned by any query.
    pub secret_value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginConnectionIdRequest {
    pub connection_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentPluginGrant {
    pub agent_id: String,
    pub plugin_id: String,
    pub connection_id: String,
    pub tool_names: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentPluginGrantRequest {
    pub agent_id: String,
    pub plugin_id: String,
    pub connection_id: String,
    pub tool_names: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginDryRunRequest {
    pub plugin_id: String,
    pub connection_id: String,
    pub tool_name: String,
    pub arguments_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginInvocationSummary {
    pub id: String,
    pub run_id: Option<String>,
    pub plugin_id: String,
    pub connection_id: String,
    pub tool_name: String,
    pub state: String,
    pub target: String,
    pub request_preview: String,
    pub response_preview: Option<String>,
    pub error: Option<String>,
    pub created_at_unix_ms: i64,
    pub completed_at_unix_ms: Option<i64>,
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
pub struct UpdateSnapshot {
    pub configured: bool,
    pub current_version: String,
    pub available_version: Option<String>,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BackupSummary {
    pub path: String,
    pub bytes: u64,
    pub created_at_unix_ms: i64,
    pub includes_database: bool,
    pub artifact_count: u64,
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
    CodePanePlacement::export_all(&config)?;
    CodePanePreset::export_all(&config)?;
    CodePaneMutation::export_all(&config)?;
    CodePaneMutationRequest::export_all(&config)?;
    CodePaneMutationResult::export_all(&config)?;
    LaunchCodePaneTerminalRequest::export_all(&config)?;
    LaunchCodePaneTerminalResult::export_all(&config)?;
    OpenCodePanePreviewRequest::export_all(&config)?;
    OpenCodePanePreviewResult::export_all(&config)?;
    CreateCodePaneThreadRequest::export_all(&config)?;
    CreateCodePaneThreadResult::export_all(&config)?;
    CloseCodePaneRequest::export_all(&config)?;
    CodeTerminalSnapshotQuery::export_all(&config)?;
    CodeTerminalSnapshot::export_all(&config)?;
    CodeTerminalSubscribeRequest::export_all(&config)?;
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
    CodeRunState::export_all(&config)?;
    CodeTaskState::export_all(&config)?;
    CodeDispatchState::export_all(&config)?;
    CodeReviewPolicy::export_all(&config)?;
    CodeReviewDecision::export_all(&config)?;
    CodeCheckpointKind::export_all(&config)?;
    CodeCheckpointState::export_all(&config)?;
    CodeManagedWorktreeState::export_all(&config)?;
    CodeOrchestrationMessageKind::export_all(&config)?;
    CodeOrchestrationEventOrigin::export_all(&config)?;
    CodeRunSummary::export_all(&config)?;
    CodeTask::export_all(&config)?;
    CodeTaskDependency::export_all(&config)?;
    CodeDispatch::export_all(&config)?;
    CodeManagedWorktree::export_all(&config)?;
    CodeCheckpoint::export_all(&config)?;
    CodeReview::export_all(&config)?;
    CodeQuestion::export_all(&config)?;
    CodeOrchestrationMessage::export_all(&config)?;
    CodeOrchestrationEventEnvelope::export_all(&config)?;
    CodeDagProposalTask::export_all(&config)?;
    CodeDagProposal::export_all(&config)?;
    CodeRunDetail::export_all(&config)?;
    CodeRunCreateRequest::export_all(&config)?;
    CodeRunUpdateRequest::export_all(&config)?;
    CodeTaskCreateRequest::export_all(&config)?;
    CodeTaskUpdateRequest::export_all(&config)?;
    CodeTaskDeleteRequest::export_all(&config)?;
    CodeDagProposalRequest::export_all(&config)?;
    CodeDagProposalAcceptRequest::export_all(&config)?;
    CodeRunRequest::export_all(&config)?;
    CodeDispatchResumeRequest::export_all(&config)?;
    CodeDispatchCancelRequest::export_all(&config)?;
    CodeDispatchTerminalRequest::export_all(&config)?;
    CodeQuestionAnswerRequest::export_all(&config)?;
    CodeTaskRetryRequest::export_all(&config)?;
    CodeReviewRequest::export_all(&config)?;
    CodeCleanupPreviewRequest::export_all(&config)?;
    CodeCleanupPreview::export_all(&config)?;
    CodeCleanupConfirmRequest::export_all(&config)?;
    CodeOrchestrationEventsQuery::export_all(&config)?;
    CodeCheckpointDiffRequest::export_all(&config)?;
    AgentApprovalPolicy::export_all(&config)?;
    AgentMemoryPolicy::export_all(&config)?;
    AgentRunState::export_all(&config)?;
    AgentToolRisk::export_all(&config)?;
    AgentToolCallState::export_all(&config)?;
    AgentApprovalDecision::export_all(&config)?;
    AgentMemoryClass::export_all(&config)?;
    AgentSkillOrigin::export_all(&config)?;
    AgentArtifactKind::export_all(&config)?;
    AgentEventKind::export_all(&config)?;
    AgentRuntimeLimits::export_all(&config)?;
    AgentSummary::export_all(&config)?;
    AgentFolderGrant::export_all(&config)?;
    AgentToolDefinition::export_all(&config)?;
    AgentSkillSummary::export_all(&config)?;
    AgentSkillConflict::export_all(&config)?;
    AgentMemorySummary::export_all(&config)?;
    AgentArtifactSummary::export_all(&config)?;
    AgentToolCallSummary::export_all(&config)?;
    AgentApprovalSummary::export_all(&config)?;
    AgentRunSummary::export_all(&config)?;
    AgentMessage::export_all(&config)?;
    AgentRunDetail::export_all(&config)?;
    AgentDetail::export_all(&config)?;
    AgentDashboard::export_all(&config)?;
    AgentCreateRequest::export_all(&config)?;
    AgentUpdateRequest::export_all(&config)?;
    AgentIdRequest::export_all(&config)?;
    AgentFolderGrantRequest::export_all(&config)?;
    AgentFolderGrantDeleteRequest::export_all(&config)?;
    AgentSkillToggleRequest::export_all(&config)?;
    AgentSkillConflictResolutionRequest::export_all(&config)?;
    AgentMemoryQuery::export_all(&config)?;
    AgentMemoryMutationRequest::export_all(&config)?;
    AgentMemoryDeleteRequest::export_all(&config)?;
    AgentRunStartRequest::export_all(&config)?;
    AgentRunControlRequest::export_all(&config)?;
    AgentApprovalDecisionRequest::export_all(&config)?;
    AgentInputRequest::export_all(&config)?;
    AgentRunsQuery::export_all(&config)?;
    AgentEventsQuery::export_all(&config)?;
    AgentEventEnvelope::export_all(&config)?;
    AgentSkillCatalog::export_all(&config)?;
    AgentExportRequest::export_all(&config)?;
    AgentConversationSummary::export_all(&config)?;
    AgentConversationDetail::export_all(&config)?;
    AgentConversationQuery::export_all(&config)?;
    AgentConversationCreateRequest::export_all(&config)?;
    AgentConversationMessageRequest::export_all(&config)?;
    AgentModelTurnRequest::export_all(&config)?;
    AgentProviderStreamEventKind::export_all(&config)?;
    AgentProviderStreamEvent::export_all(&config)?;
    AgentProviderToolOutput::export_all(&config)?;
    RoutineCatchUpPolicy::export_all(&config)?;
    RoutineConcurrencyPolicy::export_all(&config)?;
    RoutineSchedule::export_all(&config)?;
    RoutineDeliveryDestination::export_all(&config)?;
    RoutineExecutionState::export_all(&config)?;
    RoutineSummary::export_all(&config)?;
    RoutineExecution::export_all(&config)?;
    RoutineDetail::export_all(&config)?;
    RoutineCreateRequest::export_all(&config)?;
    RoutineUpdateRequest::export_all(&config)?;
    RoutineQuery::export_all(&config)?;
    RoutineIdRequest::export_all(&config)?;
    RoutineExecutionsQuery::export_all(&config)?;
    PluginAdapterKind::export_all(&config)?;
    PluginConnectionKind::export_all(&config)?;
    PluginPermission::export_all(&config)?;
    PluginToolDefinition::export_all(&config)?;
    PluginManifest::export_all(&config)?;
    PluginCatalogEntry::export_all(&config)?;
    PluginConnectionSummary::export_all(&config)?;
    PluginInstallRequest::export_all(&config)?;
    PluginConnectionCreateRequest::export_all(&config)?;
    PluginConnectionUpdateRequest::export_all(&config)?;
    PluginConnectionIdRequest::export_all(&config)?;
    AgentPluginGrant::export_all(&config)?;
    AgentPluginGrantRequest::export_all(&config)?;
    PluginDryRunRequest::export_all(&config)?;
    PluginInvocationSummary::export_all(&config)?;
    BootstrapSnapshot::export_all(&config)?;
    SetActiveModeCommand::export_all(&config)?;
    BuildInformation::export_all(&config)?;
    UpdateSnapshot::export_all(&config)?;
    BackupSummary::export_all(&config)?;
    ShellEvent::export_all(&config)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_version_is_stable() {
        assert_eq!(current_protocol_version().major, 2);
    }
}
