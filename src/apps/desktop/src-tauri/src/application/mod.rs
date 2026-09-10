#[path = "../browser.rs"]
mod browser;
#[path = "../hosted_source.rs"]
mod hosted_source;
#[path = "../release.rs"]
mod release;
#[path = "../task_sources.rs"]
mod task_sources;

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine};
use browser::{
    BrowserAnnotationSyncRequest, BrowserBoundsRequest, BrowserCaptureRequest,
    BrowserClipboardRequest, BrowserConfiguration, BrowserCookieFileRequest,
    BrowserCookieSourceRequest, BrowserFrame, BrowserIdRequest, BrowserManager,
    BrowserNavigationRequest, BrowserOpenRequest, BrowserProfileIdRequest, BrowserProfileRequest,
    BrowserRuntimeState, BrowserSettingsRequest, BrowserSwitchProfileRequest,
    BrowserTouchEmulationRequest, BrowserViewportRequest, ClipboardReadRequest,
};
use hiveory_agent_runtime::HiveoryAgentRuntime;
use hiveory_artifact_store::{HiveoryArtifactError, HiveoryArtifactStore, HiveoryStoredAttachment};
use hiveory_chat_domain::{estimate_context_tokens, validate_send_request};
use hiveory_code_domain::{
    apply_layout_preset, default_layout, split_pane, validate_layout, visual_leaf_order,
};
use hiveory_code_orchestration::{HiveoryCodeOrchestration, HiveoryCodeOrchestrationError};
use hiveory_code_runtime::{
    resolved_adapter_command, stream_cli_chat_turn, HiveoryCodeRuntime, HiveoryCodeRuntimeError,
};
use hiveory_git_service::{HiveoryGitError, HiveoryGitService};
use hiveory_job_runtime::HiveoryJobRuntime;
use hiveory_model_gateway::{
    HiveoryModelProvider, HiveoryOpenAiResponsesProvider, HiveoryProviderError,
};
use hiveory_notification_service::HiveoryNotificationService;
use hiveory_persistence::{
    agent::HiveoryAgentStore,
    chat::{HiveoryChatStore, HiveoryChatStoreError},
    HiveoryPersistence, HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID,
};
use hiveory_plugin_runtime::{HiveoryPluginRuntime, HiveoryPluginRuntimeError};
use hiveory_protocol::{
    canonical_code_adapter_id, current_protocol_version, AgentApprovalDecisionRequest,
    AgentConversationCreateRequest, AgentConversationDetail, AgentConversationQuery,
    AgentConversationSummary, AgentCreateRequest, AgentDashboard, AgentDetail, AgentEventEnvelope,
    AgentEventsQuery, AgentExportRequest, AgentFolderGrant, AgentFolderGrantDeleteRequest,
    AgentFolderGrantRequest, AgentIdRequest, AgentInputRequest, AgentMemoryDeleteRequest,
    AgentMemoryMutationRequest, AgentMemoryQuery, AgentMemorySummary, AgentPluginGrant,
    AgentPluginGrantRequest, AgentRunControlRequest, AgentRunDetail, AgentRunStartRequest,
    AgentRunSummary, AgentRunsQuery, AgentSkillCatalog, AgentSkillConflictResolutionRequest,
    AgentSkillSummary, AgentSkillToggleRequest, AgentToolDefinition, AgentToolRisk,
    AgentUpdateRequest, ApiError, ApplicationMode, BackupSummary, BootstrapSnapshot,
    BuildInformation, ChatAttachmentBytesRequest, ChatAttachmentImportRequest,
    ChatAttachmentSummary, ChatBranchRequest, ChatConversationDetail,
    ChatConversationFolderRequest, ChatCreateRequest, ChatDeleteRequest,
    ChatDiscardAttachmentRequest, ChatDraftRequest, ChatEditRequest, ChatEngineAvailability,
    ChatEngineCatalog, ChatEngineSummary, ChatEventEnvelope, ChatEventsQuery, ChatExportRequest,
    ChatFolderCreateRequest, ChatFolderDeleteRequest, ChatFolderSummary, ChatFolderUpdateRequest,
    ChatMessagePart, ChatMetadataRequest, ChatModelSummary, ChatModelTurnRequest,
    ChatProviderMessage, ChatProviderPart, ChatProviderStreamEvent, ChatReasoningEffort,
    ChatSendRequest, ChatSidebarPage, ChatSidebarQuery, ChatStreamRequest, ChatTurnRequest,
    CloseCodePaneRequest, CodeCheckpointDiffRequest, CodeCleanupConfirmRequest, CodeCleanupPreview,
    CodeCleanupPreviewRequest, CodeDagProposal, CodeDagProposalAcceptRequest,
    CodeDagProposalRequest, CodeDecisionGate, CodeDispatchCancelRequest, CodeDispatchResumeRequest,
    CodeDispatchTerminalRequest, CodeDocument, CodeFileTree, CodeFileTreeQuery,
    CodeGateCreateRequest, CodeGateResolveRequest, CodeGatesQuery, CodeGitBranchCheckoutRequest,
    CodeGitBranchCreateRequest, CodeGitBranchDeleteRequest, CodeGitCommitRequest, CodeGitDiff,
    CodeGitDiffRequest, CodeGitDiscardRequest, CodeGitOperationResult, CodeGitRemoteRequest,
    CodeGitRepositoryRequest, CodeGitRepositorySummary, CodeGitStageRequest,
    CodeGitStashIndexRequest, CodeGitStashSaveRequest, CodeGitStatus, CodeGitStatusRequest,
    CodeHostedIssueActionRequest, CodeHostedIssueCreateRequest, CodeHostedIssueUpdateRequest,
    CodeHostedOperationResult, CodeHostedPullRequestActionRequest,
    CodeHostedPullRequestCreateRequest, CodeHostedTracking, CodeHostedTrackingRequest,
    CodeLaunchPresetCreateRequest, CodeLaunchPresetEntry, CodeLaunchPresetLaunchTarget,
    CodeLaunchPresetOpenRequest, CodeLaunchPresetOpenResult, CodeLaunchPresetPaneKind,
    CodeLaunchPresetQuery, CodeLaunchPresetSummary, CodeLaunchPresetUpdateRequest,
    CodeLayoutPresetCreateRequest, CodeLayoutPresetOpenRequest, CodeLayoutPresetQuery,
    CodeLayoutPresetSummary, CodeLayoutPresetUpdateRequest, CodeMailboxAckRequest,
    CodeMailboxDelivery, CodeMailboxQuery, CodeMailboxSendRequest, CodeOrchestrationEventEnvelope,
    CodeOrchestrationEventsQuery, CodePaneKind, CodePaneLayout, CodePaneMutation,
    CodePaneMutationRequest, CodePaneMutationResult, CodePanePlacement, CodePanePreset,
    CodePreviewRequest, CodePreviewState, CodePreviewSummary, CodeProjectAddRequest,
    CodeProjectKind, CodeProjectRemoveRequest, CodeProjectSummary, CodeQuestionAnswerRequest,
    CodeReadFileRequest, CodeRenameFileRequest, CodeRenameFileResult, CodeReviewRequest,
    CodeRunCreateRequest, CodeRunDetail, CodeRunRequest, CodeRunSummary, CodeRunUpdateRequest,
    CodeSaveFileRequest, CodeSaveLayoutRequest, CodeSnapshot, CodeTaskCreateRequest,
    CodeTaskDeleteRequest, CodeTaskRetryRequest, CodeTaskUpdateRequest, CodeTerminalEvent,
    CodeTerminalInputRequest, CodeTerminalKind, CodeTerminalResizeRequest, CodeTerminalSnapshot,
    CodeTerminalSnapshotQuery, CodeTerminalStartRequest, CodeTerminalStopRequest,
    CodeTerminalSubscribeRequest, CodeTerminalSummary, CodeWorkspaceCreateRequest,
    CodeWorkspaceDetail, CodeWorkspaceOpenInRequest, CodeWorkspaceOpenRequest,
    CodeWorkspaceOpenTarget, CodeWorkspaceParentRequest, CodeWorkspaceQuery,
    CodeWorkspaceRemoveRequest, CodeWorkspaceSummary, CodeWorkspaceTrust,
    CodeWorkspaceTrustRequest, CodeWorkspaceUpdateRequest, CommandEnvelope,
    CreateCodePaneMarkdownRequest, CreateCodePaneMarkdownResult, DiagnosticSnapshot, JobState,
    LaunchCodePaneTerminalRequest, LaunchCodePaneTerminalResult, OpenCodePaneMarkdownRequest,
    OpenCodePaneMarkdownResult, OpenCodePanePreviewRequest, OpenCodePanePreviewResult,
    PluginCatalogEntry, PluginConnectionCreateRequest, PluginConnectionIdRequest,
    PluginConnectionSummary, PluginConnectionUpdateRequest, PluginDryRunRequest,
    PluginInstallRequest, PluginInvocationSummary, PluginManifest, ProviderDiagnosticRequest,
    ResponseEnvelope, RetryClass, RoutineCreateRequest, RoutineDetail, RoutineExecution,
    RoutineExecutionsQuery, RoutineIdRequest, RoutineQuery, RoutineSummary, RoutineUpdateRequest,
    SetActiveModeCommand, SharedEventEnvelope, SharedEventKind, TaskSourceConnectRequest,
    TaskSourceIdRequest, TaskSourceQuery, TaskSourceSnapshot, UpdateSnapshot,
    HIVEORY_PROTOCOL_VERSION,
};
use hiveory_routine_scheduler::{HiveoryRoutineScheduler, HiveoryRoutineSchedulerError};
use hiveory_secret_store::{HiveoryKeyringSecretStore, HiveorySecretStoreHandle};
use hiveory_terminal_host::{HiveoryTerminalHostClient, HiveoryTerminalHostError};
use hiveory_tool_runtime::{HiveoryAuditLog, HiveoryExternalToolProvider};
use hiveory_workspace_service::{
    HiveoryWorkspaceError, HiveoryWorkspaceMetadata, HiveoryWorkspaceService,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io,
    path::{Path, PathBuf},
    process::Command,
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
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::{broadcast, mpsc, oneshot},
    time::{timeout, Duration},
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Deserialize)]
struct CodeCreateFileRequest {
    workspace_id: String,
    relative_path: String,
    content: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CodeImportAssetRequest {
    workspace_id: String,
    source_path: String,
    target_directory: String,
}

#[derive(Debug, Clone, Serialize)]
struct CodeImportedAsset {
    relative_path: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CodeReadAssetRequest {
    workspace_id: String,
    document_path: String,
    source: String,
}

#[derive(Debug, Clone, Serialize)]
struct CodeAssetData {
    data_base64: String,
    mime_type: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ExternalUrlRequest {
    url: String,
}

const BROWSER_USE_SETTINGS_KEY: &str = "browser.use.settings.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BrowserUseSettings {
    enabled: bool,
    target: String,
}

impl Default for BrowserUseSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            target: "inner".to_owned(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct BrowserUseSettingsRequest {
    enabled: bool,
    target: String,
}

fn sanitize_browser_use_settings(value: BrowserUseSettings) -> BrowserUseSettings {
    BrowserUseSettings {
        enabled: value.enabled,
        target: match value.target.as_str() {
            "external" => "external".to_owned(),
            "desktop" => "desktop".to_owned(),
            _ => "inner".to_owned(),
        },
    }
}

struct HiveoryShellState {
    active_mode: RwLock<ApplicationMode>,
}
impl Default for HiveoryShellState {
    fn default() -> Self {
        Self {
            active_mode: RwLock::new(ApplicationMode::Agent),
        }
    }
}

struct HiveoryUpdateState {
    pending: std::sync::Mutex<Option<tauri_plugin_updater::Update>>,
}

impl Default for HiveoryUpdateState {
    fn default() -> Self {
        Self {
            pending: std::sync::Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HiveoryWindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct CodeTerminalHistorySettingRequest {
    terminal_id: String,
    enabled: bool,
}

const CODE_WORKSPACE_CONTEXT_SETTING: &str = "code_workspace_context.v1";
const TASK_BOARD_PREFERENCES_SETTING: &str = "task_board_preferences.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodeWorkspaceContext {
    workspace_id: Option<String>,
    section: String,
}

impl Default for CodeWorkspaceContext {
    fn default() -> Self {
        Self {
            workspace_id: None,
            section: "workspace".to_owned(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct CodeWorkspaceContextUpdate {
    workspace_id: Option<String>,
    section: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct TaskBoardPreferences {
    statuses: HashMap<String, String>,
    pinned: Vec<String>,
}

fn sanitize_task_board_preferences(mut preferences: TaskBoardPreferences) -> TaskBoardPreferences {
    preferences.statuses.retain(|task_id, status| {
        task_id.len() <= 128
            && matches!(
                status.as_str(),
                "todo" | "in_progress" | "in_review" | "done"
            )
    });
    if preferences.statuses.len() > 10_000 {
        preferences.statuses = preferences.statuses.into_iter().take(10_000).collect();
    }
    let mut seen = HashSet::new();
    preferences
        .pinned
        .retain(|task_id| task_id.len() <= 128 && seen.insert(task_id.clone()));
    preferences.pinned.truncate(1_000);
    preferences
}

#[derive(Debug, Clone, Deserialize)]
struct TaskBoardPreferencesUpdate {
    preferences: TaskBoardPreferences,
}

#[derive(Debug, Clone, Deserialize)]
struct AgentSkillImportRequest {
    source_path: String,
}

#[derive(Debug, Clone, Deserialize)]
struct AgentSkillCreateRequest {
    source: String,
}

#[derive(Clone)]
struct HiveoryExternalTools {
    plugin: HiveoryPluginRuntime,
    browser: HiveoryBrowserToolProvider,
    computer: HiveoryComputerUseToolProvider,
}

/// The capabilities a coding CLI may use during one Hiveory-launched pane.
/// Unlike an Agent run, the CLI process lives outside Tauri, so calls are
/// forwarded through a loopback bridge back to the owning desktop process.
#[derive(Clone)]
struct HiveoryCliSessionTools {
    plugin: HiveoryPluginRuntime,
    browser: HiveoryBrowserToolProvider,
    computer: HiveoryComputerUseToolProvider,
    agent_panes: HiveoryCliAgentPaneProvider,
    skills: HiveoryAgentStore,
    orchestration: HiveoryCodeOrchestration,
    session_id: String,
    workspace_id: String,
}

#[derive(Debug, Deserialize)]
struct CliSessionBridgeRequest {
    token: String,
    method: String,
    name: Option<String>,
    arguments: Option<Value>,
}

#[derive(Clone)]
struct CliSessionBridge {
    endpoint: String,
    token: String,
}

#[derive(Clone)]
struct HiveoryBrowserToolProvider {
    app: tauri::AppHandle,
    manager: BrowserManager,
    persistence: HiveoryPersistence,
    code_workspaces: HiveoryWorkspaceService,
    default_workspace_id: Option<String>,
}

#[derive(Clone)]
struct HiveoryComputerUseToolProvider {
    persistence: HiveoryPersistence,
}

/// Owns the small, capability-scoped part of Code workspace management that a
/// CLI session needs.  Keeping this separate from the renderer command avoids
/// the previous dead end where an agent knew how to create a run but had no
/// way to create the visible worker pane in which that run could be worked.
#[derive(Clone)]
struct HiveoryCliAgentPaneProvider {
    foundation: HiveoryFoundation,
    app: tauri::AppHandle,
    browser: BrowserManager,
    workspace_id: String,
}

#[derive(Debug, Deserialize)]
struct CliOpenAgentPaneRequest {
    #[serde(default)]
    adapter_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    reuse_pane_id: Option<String>,
    #[serde(default)]
    agent_launch_mode: hiveory_protocol::CodeAgentLaunchMode,
    #[serde(default = "default_cli_terminal_cols")]
    cols: u16,
    #[serde(default = "default_cli_terminal_rows")]
    rows: u16,
}

#[derive(Debug, Deserialize)]
struct CliRenameAgentPaneRequest {
    #[serde(default)]
    pane_id: Option<String>,
    title: String,
}

#[derive(Debug, Clone, Serialize)]
struct CliAgentPaneOpenedEvent {
    layout: CodePaneLayout,
    terminal: CodeTerminalSummary,
}

const CLI_AGENT_PANE_OPENED_EVENT: &str = "hiveory-code-agent-pane-opened";

fn default_cli_terminal_cols() -> u16 {
    100
}
fn default_cli_terminal_rows() -> u16 {
    30
}

#[derive(Debug, Clone, Serialize)]
struct CliBrowserPaneOpenedEvent {
    layout: CodePaneLayout,
    preview: CodePreviewSummary,
}

const CLI_BROWSER_PANE_OPENED_EVENT: &str = "hiveory-code-preview-opened";

fn agent_tool(
    name: &str,
    description: &str,
    schema: &str,
    risk: AgentToolRisk,
) -> AgentToolDefinition {
    AgentToolDefinition {
        name: name.to_owned(),
        description: description.to_owned(),
        input_schema_json: schema.to_owned(),
        risk,
    }
}

fn browser_argument(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{key} is required"))
}

fn browser_js_string(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.chars().count() > max_chars {
        return Err(format!("{label} is too long"));
    }
    serde_json::to_string(value).map_err(|error| format!("{label} could not be encoded: {error}"))
}

impl HiveoryCliAgentPaneProvider {
    async fn list(&self) -> Result<Value, String> {
        let layout = self
            .foundation
            .persistence
            .code_layout(&self.workspace_id)
            .await
            .map_err(|error| error.to_string())?
            .unwrap_or_else(|| default_layout(&self.workspace_id));
        let terminals = self
            .foundation
            .terminal_host
            .list()
            .await
            .map_err(|error| error.to_string())?;
        let panes = layout
            .nodes
            .iter()
            .filter(|node| node.children.is_empty() && node.kind == CodePaneKind::CodingAgent)
            .map(|node| {
                let terminal = node.resource_id.as_deref().and_then(|terminal_id| {
                    terminals.iter().find(|terminal| terminal.id == terminal_id)
                });
                json!({
                    "pane_id": node.pane_id,
                    "title": node.title,
                    "terminal": terminal,
                    "reusable": terminal.is_none_or(|terminal| matches!(
                        terminal.state,
                        hiveory_protocol::CodeTerminalState::Exited
                            | hiveory_protocol::CodeTerminalState::Failed
                            | hiveory_protocol::CodeTerminalState::Interrupted
                            | hiveory_protocol::CodeTerminalState::Dormant
                    )),
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({ "workspace_id": self.workspace_id, "panes": panes }))
    }

    async fn open(&self, arguments: &Value) -> Result<Value, String> {
        let request = serde_json::from_value::<CliOpenAgentPaneRequest>(arguments.clone())
            .map_err(|error| format!("invalid agent-pane request: {error}"))?;
        if !(20..=500).contains(&request.cols) || !(10..=500).contains(&request.rows) {
            return Err("terminal dimensions are invalid".to_owned());
        }
        let adapter_id = match request.adapter_id.as_deref() {
            Some(adapter_id) => canonical_code_adapter_id(adapter_id)
                .ok_or_else(|| "The requested coding-agent adapter is not supported.".to_owned())?
                .to_owned(),
            None => "codex-cli".to_owned(),
        };
        self.foundation
            .code_workspaces
            .require(
                &self.workspace_id,
                hiveory_protocol::CodeWorkspaceCapability::ExecuteProcesses,
            )
            .map_err(|error| error.to_string())?;
        let root = self
            .foundation
            .code_workspaces
            .root_path(&self.workspace_id)
            .map_err(|error| error.to_string())?;
        let current = self
            .foundation
            .persistence
            .code_layout(&self.workspace_id)
            .await
            .map_err(|error| error.to_string())?
            .unwrap_or_else(|| default_layout(&self.workspace_id));
        let terminals = self
            .foundation
            .terminal_host
            .list()
            .await
            .map_err(|error| error.to_string())?;

        let (mut next, pane_id) = if let Some(reuse_pane_id) = request.reuse_pane_id.as_deref() {
            let pane = current
                .nodes
                .iter()
                .find(|pane| pane.pane_id == reuse_pane_id && pane.children.is_empty())
                .ok_or_else(|| "The requested reusable pane was not found.".to_owned())?;
            if pane.kind != CodePaneKind::CodingAgent {
                return Err("Only a Hiveory coding-agent pane can be reused.".to_owned());
            }
            if let Some(terminal_id) = pane.resource_id.as_deref() {
                if let Some(terminal) = terminals.iter().find(|terminal| terminal.id == terminal_id)
                {
                    if matches!(
                        terminal.state,
                        hiveory_protocol::CodeTerminalState::Starting
                            | hiveory_protocol::CodeTerminalState::Running
                    ) {
                        return Err(
                            "The requested coding-agent pane is busy and cannot be reused."
                                .to_owned(),
                        );
                    }
                }
            }
            (current.clone(), reuse_pane_id.to_owned())
        } else if is_empty_workspace_layout(&current) {
            (current.clone(), current.root_id.clone())
        } else {
            let target_id = current
                .focused_pane_id
                .as_deref()
                .filter(|pane_id| {
                    current
                        .nodes
                        .iter()
                        .any(|node| node.pane_id == *pane_id && node.children.is_empty())
                })
                .map(ToOwned::to_owned)
                .or_else(|| visual_leaf_order(&current).into_iter().next())
                .ok_or_else(|| {
                    "The workspace has no available pane for a coding agent.".to_owned()
                })?;
            let next = split_pane(&current, &target_id, CodePanePlacement::Right)
                .map_err(|error| error.to_string())?;
            let existing = current
                .nodes
                .iter()
                .map(|node| node.pane_id.as_str())
                .collect::<HashSet<_>>();
            let pane_id = next
                .nodes
                .iter()
                .find(|node| node.children.is_empty() && !existing.contains(node.pane_id.as_str()))
                .map(|node| node.pane_id.clone())
                .ok_or_else(|| "The coding-agent pane could not be created.".to_owned())?;
            (next, pane_id)
        };

        let session_id = format!("cli-worker-{}", uuid::Uuid::now_v7());
        // Opening a pane creates another CLI bridge, whose tool set can in
        // turn open a pane. Box this recursive async edge so the bridge
        // connection future remains sized and Send for Tauri's runtime.
        let session_integration = Box::pin(prepare_cli_session_integration(
            &self.foundation,
            self.app.clone(),
            self.browser.clone(),
            self.workspace_id.clone(),
            Some(&adapter_id),
            Some(session_id.clone()),
        ))
        .await
        .map_err(|error| error.message)?
        .ok_or_else(|| "The selected coding-agent adapter is not supported.".to_owned())?;
        let terminal = self
            .foundation
            .terminal_host
            .start(
                &CodeTerminalStartRequest {
                    workspace_id: self.workspace_id.clone(),
                    kind: CodeTerminalKind::CodingAgent,
                    cols: request.cols,
                    rows: request.rows,
                    adapter_id: Some(adapter_id.clone()),
                    model: request.model.clone(),
                    agent_launch_mode: request.agent_launch_mode,
                    resume_session_id: None,
                    session_integration: Some(session_integration),
                },
                &root,
                None,
                None,
            )
            .await
            .map_err(|error| error.to_string())?;

        let node = next
            .nodes
            .iter_mut()
            .find(|node| node.pane_id == pane_id)
            .ok_or_else(|| "The coding-agent pane could not be found after launch.".to_owned())?;
        node.kind = CodePaneKind::CodingAgent;
        node.resource_id = Some(terminal.id.clone());
        node.title = request
            .title
            .filter(|title| !title.trim().is_empty())
            .or_else(|| Some(generated_pane_title_for_layout(&current)));
        next.focused_pane_id = Some(pane_id.clone());
        validate_layout(&next).map_err(|error| error.to_string())?;
        let layout = match self
            .foundation
            .persistence
            .mutate_code_layout(&self.workspace_id, current.revision, &next)
            .await
        {
            Ok(layout) => layout,
            Err(error) => {
                let _ = self
                    .foundation
                    .terminal_host
                    .stop(&CodeTerminalStopRequest {
                        terminal_id: terminal.id.clone(),
                        force: true,
                    })
                    .await;
                return Err(if error.to_string().contains("layout_conflict") {
                    "The workspace changed while the agent pane was opening. Try again.".to_owned()
                } else {
                    error.to_string()
                });
            }
        };
        let _ = self.app.emit_to(
            "main",
            CLI_AGENT_PANE_OPENED_EVENT,
            CliAgentPaneOpenedEvent {
                layout: layout.clone(),
                terminal: terminal.clone(),
            },
        );
        Ok(json!({
            "workspace_id": self.workspace_id,
            "pane_id": pane_id,
            "session_id": session_id,
            "address": format!("worker:{session_id}"),
            "layout": layout,
            "terminal": terminal,
        }))
    }

    /// Renames one managed coding-agent pane.  When no pane ID is supplied,
    /// the most recently launched agent is selected from durable terminal
    /// metadata, which makes follow-ups such as "name the previous agent Max"
    /// deterministic even after several conversational turns.
    async fn rename(&self, arguments: &Value) -> Result<Value, String> {
        let request = serde_json::from_value::<CliRenameAgentPaneRequest>(arguments.clone())
            .map_err(|error| format!("invalid agent-pane rename request: {error}"))?;
        let title = request.title.trim();
        if title.is_empty() {
            return Err("title is required".to_owned());
        }

        for attempt in 0..4 {
            let current = self
                .foundation
                .persistence
                .code_layout(&self.workspace_id)
                .await
                .map_err(|error| error.to_string())?
                .unwrap_or_else(|| default_layout(&self.workspace_id));
            let terminals = self
                .foundation
                .terminal_host
                .list()
                .await
                .map_err(|error| error.to_string())?;
            let pane_id = match request.pane_id.as_deref() {
                Some(pane_id) => pane_id.to_owned(),
                None => current
                    .nodes
                    .iter()
                    .filter(|node| {
                        node.children.is_empty() && node.kind == CodePaneKind::CodingAgent
                    })
                    .max_by_key(|node| {
                        node.resource_id
                            .as_deref()
                            .and_then(|terminal_id| {
                                terminals.iter().find(|terminal| terminal.id == terminal_id)
                            })
                            .map(|terminal| terminal.started_at_unix_ms)
                            .unwrap_or(i64::MIN)
                    })
                    .map(|node| node.pane_id.clone())
                    .ok_or_else(|| {
                        "There is no previously opened coding-agent pane to rename.".to_owned()
                    })?,
            };
            let renamed = hiveory_code_domain::rename_pane(&current, &pane_id, title)
                .map_err(|error| error.to_string())?;
            match self
                .foundation
                .persistence
                .mutate_code_layout(&self.workspace_id, current.revision, &renamed)
                .await
            {
                Ok(layout) => {
                    let saved_title = layout
                        .nodes
                        .iter()
                        .find(|node| node.pane_id == pane_id)
                        .and_then(|node| node.title.clone())
                        .ok_or_else(|| "The renamed pane was not saved.".to_owned())?;
                    let _ = self
                        .app
                        .emit_to("main", "hiveory-code-layout-updated", layout.clone());
                    return Ok(json!({
                        "workspace_id": self.workspace_id,
                        "pane_id": pane_id,
                        "title": saved_title,
                        "layout": layout,
                    }));
                }
                Err(error) if error.to_string().contains("layout_conflict") && attempt < 3 => {
                    continue
                }
                Err(error) => return Err(error.to_string()),
            }
        }
        Err("The workspace changed while the pane was being renamed. Try again.".to_owned())
    }
}

fn browser_snapshot_expression() -> &'static str {
    r#"(() => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const selectorFor = (node) => {
        if (node.id && /^[A-Za-z][\w-]{0,80}$/.test(node.id)) return `#${node.id}`;
        const parts = [];
        let current = node;
        while (current && current.nodeType === 1 && parts.length < 6) {
          let part = current.tagName.toLowerCase();
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((item) => item.tagName === current.tagName);
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
          parts.unshift(part);
          current = parent;
        }
        return parts.join(' > ');
      };
      const controls = Array.from(document.querySelectorAll('a,button,input,textarea,select,option,[role],[contenteditable="true"],h1,h2,h3,h4'))
        .filter(visible)
        .slice(0, 120)
        .map((node) => ({
          selector: selectorFor(node),
          tag: node.tagName.toLowerCase(),
          role: node.getAttribute('role'),
          type: node.getAttribute('type'),
          name: node.getAttribute('name'),
          label: node.getAttribute('aria-label'),
          placeholder: node.getAttribute('placeholder'),
          text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        }));
      return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 8000),
        controls,
      };
    })()"#
}

const COMPUTER_USE_RUNTIME_PS1: &str =
    include_str!("../../assets/computer-use-windows-runtime.ps1");

fn computer_operation_tool(operation: &Value) -> Result<&str, String> {
    let tool = operation
        .get("tool")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "computer operation tool is required".to_owned())?;
    const ALLOWED_TOOLS: &[&str] = &[
        "click",
        "perform_secondary_action",
        "scroll",
        "drag",
        "type_text",
        "press_key",
        "hotkey",
        "paste_text",
        "set_value",
    ];
    if !ALLOWED_TOOLS.contains(&tool) {
        return Err(format!("unsupported computer operation: {tool}"));
    }
    Ok(tool)
}

fn computer_operation_app(operation: &Value) -> Result<String, String> {
    operation
        .get("app")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "app is required for a computer action".to_owned())
}

impl HiveoryComputerUseToolProvider {
    async fn is_enabled(&self) -> bool {
        self.persistence
            .get_setting(BROWSER_USE_SETTINGS_KEY)
            .await
            .ok()
            .flatten()
            .and_then(|value| serde_json::from_str::<BrowserUseSettings>(&value).ok())
            .map(|value| value.enabled)
            .unwrap_or(false)
    }

    async fn definitions(&self) -> Vec<AgentToolDefinition> {
        if !self.is_enabled().await {
            return Vec::new();
        }
        vec![
            agent_tool(
                "computer.capabilities",
                "Describe the local Windows accessibility, screenshot, and input capabilities available to Computer Use.",
                r#"{"type":"object","properties":{},"required":[],"additionalProperties":false}"#,
                AgentToolRisk::ReadOnly,
            ),
            agent_tool(
                "computer.list_apps",
                "List visible desktop applications that Computer Use can inspect. Password-manager windows are excluded.",
                r#"{"type":"object","properties":{},"required":[],"additionalProperties":false}"#,
                AgentToolRisk::ReadOnly,
            ),
            agent_tool(
                "computer.list_windows",
                "List windows for a visible desktop application before selecting a window for Computer Use.",
                r#"{"type":"object","properties":{"app":{"type":"string"}},"required":["app"],"additionalProperties":false}"#,
                AgentToolRisk::ReadOnly,
            ),
            agent_tool(
                "computer.snapshot",
                "Inspect an application's accessibility tree and optionally capture a bounded screenshot. Use a fresh snapshot before acting.",
                r#"{"type":"object","properties":{"app":{"type":"string"},"window_id":{"type":["string","null"]},"window_index":{"type":["integer","null"]},"no_screenshot":{"type":"boolean"},"restore_window":{"type":"boolean"}},"required":["app","window_id","window_index","no_screenshot","restore_window"],"additionalProperties":false}"#,
                AgentToolRisk::ReadOnly,
            ),
            agent_tool(
                "computer.action",
                "Perform one user-authorized accessibility or input action in a desktop app, then return a fresh state snapshot.",
                r#"{"type":"object","properties":{"operation":{"type":"object","properties":{"tool":{"type":"string"}},"required":["tool"],"additionalProperties":true}},"required":["operation"],"additionalProperties":false}"#,
                AgentToolRisk::ExternallyVisible,
            ),
        ]
    }

    async fn execute(&self, name: &str, arguments_json: &str) -> Result<String, String> {
        if !self.is_enabled().await {
            return Err("Computer Use is disabled in Settings. Enable Browser Use before asking an agent to control the desktop.".to_owned());
        }
        let args: Value = serde_json::from_str(arguments_json)
            .map_err(|_| "computer tool arguments are not valid JSON".to_owned())?;
        let operation = match name {
            "computer.capabilities" => json!({ "tool": "handshake" }),
            "computer.list_apps" => json!({ "tool": "list_apps" }),
            "computer.list_windows" => json!({
                "tool": "list_windows",
                "app": computer_operation_app(&args)?
            }),
            "computer.snapshot" => json!({
                "tool": "get_app_state",
                "app": computer_operation_app(&args)?,
                "windowId": args.get("window_id").cloned().unwrap_or(Value::Null),
                "windowIndex": args.get("window_index").cloned().unwrap_or(Value::Null),
                "noScreenshot": args.get("no_screenshot").and_then(Value::as_bool).unwrap_or(false),
                "restoreWindow": args.get("restore_window").and_then(Value::as_bool).unwrap_or(false),
            }),
            "computer.action" => {
                let operation = args
                    .get("operation")
                    .cloned()
                    .ok_or_else(|| "operation is required".to_owned())?;
                if !operation.is_object() {
                    return Err("operation must be an object".to_owned());
                }
                computer_operation_tool(&operation)?;
                computer_operation_app(&operation)?;
                operation
            }
            _ => return Err("computer tool is not available".to_owned()),
        };
        let operation_json = serde_json::to_string(&operation)
            .map_err(|error| format!("computer operation could not be encoded: {error}"))?;
        if operation_json.len() > 32_000 {
            return Err("computer operation is too large".to_owned());
        }
        self.run_operation(&operation_json).await
    }

    async fn run_operation(&self, operation_json: &str) -> Result<String, String> {
        let nonce = uuid::Uuid::now_v7().to_string();
        let directory = std::env::temp_dir().join("hiveory-computer-use");
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("computer runtime directory could not be created: {error}"))?;
        let script_path = directory.join(format!("{nonce}.ps1"));
        let operation_path = directory.join(format!("{nonce}.json"));
        std::fs::write(&script_path, COMPUTER_USE_RUNTIME_PS1)
            .map_err(|error| format!("computer runtime could not be prepared: {error}"))?;
        std::fs::write(&operation_path, operation_json)
            .map_err(|error| format!("computer operation could not be prepared: {error}"))?;

        let mut process = tokio::process::Command::new(if cfg!(target_os = "windows") {
            "powershell.exe"
        } else {
            "pwsh"
        });
        process.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ]);
        process
            .arg(&script_path)
            .arg("-OperationPath")
            .arg(&operation_path);
        let output = tokio::time::timeout(std::time::Duration::from_secs(60), process.output())
            .await
            .map_err(|_| "computer operation timed out after 60 seconds".to_owned())?
            .map_err(|error| error.to_string());
        let _ = std::fs::remove_file(&script_path);
        let _ = std::fs::remove_file(&operation_path);
        let output = output?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if stdout.is_empty() {
            return Err(if stderr.is_empty() {
                format!("computer runtime exited with status {}", output.status)
            } else {
                format!("computer runtime failed: {stderr}")
            });
        }
        if stdout.len() > 4 * 1024 * 1024 {
            return Err("computer runtime returned too much data".to_owned());
        }
        let payload: Value = serde_json::from_str(&stdout).map_err(|error| {
            if stderr.is_empty() {
                format!("computer runtime returned invalid JSON: {error}")
            } else {
                format!("computer runtime returned invalid JSON: {error}; {stderr}")
            }
        })?;
        serde_json::to_string(&payload).map_err(|error| error.to_string())
    }
}

impl HiveoryBrowserToolProvider {
    async fn is_enabled(&self) -> bool {
        self.persistence
            .get_setting(BROWSER_USE_SETTINGS_KEY)
            .await
            .ok()
            .flatten()
            .and_then(|value| serde_json::from_str::<BrowserUseSettings>(&value).ok())
            .map(|value| value.enabled)
            .unwrap_or(false)
    }

    async fn definitions(&self) -> Vec<AgentToolDefinition> {
        if !self.is_enabled().await {
            return Vec::new();
        }
        vec![
            agent_tool(
                "browser.snapshot",
                "Inspect the visible text and interactive controls in the embedded Browser, including stable CSS selectors for follow-up actions.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"}},"required":["browser_id"],"additionalProperties":false}"#,
                AgentToolRisk::ReadOnly,
            ),
            agent_tool(
                "browser.state",
                "Read the current URL, title, loading state, and navigation capabilities of an open embedded Hiveory Browser pane.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"}},"required":["browser_id"],"additionalProperties":false}"#,
                AgentToolRisk::ReadOnly,
            ),
            agent_tool(
                "browser.open",
                "Open or reconnect an embedded Hiveory Browser pane for a workspace.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"},"workspace_id":{"type":"string"},"url":{"type":"string"}},"required":["browser_id","workspace_id","url"],"additionalProperties":false}"#,
                AgentToolRisk::InternalMutation,
            ),
            agent_tool(
                "browser.navigate",
                "Navigate an open embedded Hiveory Browser pane to a web address.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"},"url":{"type":"string"}},"required":["browser_id","url"],"additionalProperties":false}"#,
                AgentToolRisk::ExternallyVisible,
            ),
            agent_tool(
                "browser.back",
                "Go back in an embedded Hiveory Browser pane.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"}},"required":["browser_id"],"additionalProperties":false}"#,
                AgentToolRisk::InternalMutation,
            ),
            agent_tool(
                "browser.forward",
                "Go forward in an embedded Hiveory Browser pane.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"}},"required":["browser_id"],"additionalProperties":false}"#,
                AgentToolRisk::InternalMutation,
            ),
            agent_tool(
                "browser.reload",
                "Reload the current page in an embedded Hiveory Browser pane.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"}},"required":["browser_id"],"additionalProperties":false}"#,
                AgentToolRisk::InternalMutation,
            ),
            agent_tool(
                "browser.click",
                "Click one user-authorized element in the embedded Browser using a CSS selector.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"},"selector":{"type":"string"}},"required":["browser_id","selector"],"additionalProperties":false}"#,
                AgentToolRisk::ExternallyVisible,
            ),
            agent_tool(
                "browser.fill",
                "Fill one user-authorized input in the embedded Browser using a CSS selector.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"},"selector":{"type":"string"},"value":{"type":"string"}},"required":["browser_id","selector","value"],"additionalProperties":false}"#,
                AgentToolRisk::ExternallyVisible,
            ),
            agent_tool(
                "browser.press",
                "Dispatch a keyboard key to one user-authorized element in the embedded Browser.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"},"selector":{"type":"string"},"key":{"type":"string"}},"required":["browser_id","selector","key"],"additionalProperties":false}"#,
                AgentToolRisk::ExternallyVisible,
            ),
            agent_tool(
                "browser.scroll",
                "Scroll an embedded Hiveory Browser pane vertically by a bounded number of pixels.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"},"delta_y":{"type":"number"}},"required":["browser_id","delta_y"],"additionalProperties":false}"#,
                AgentToolRisk::InternalMutation,
            ),
            agent_tool(
                "browser.open_external",
                "Open the current embedded Browser page in the user's default external browser.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"}},"required":["browser_id"],"additionalProperties":false}"#,
                AgentToolRisk::ExternallyVisible,
            ),
            agent_tool(
                "browser.open_external_url",
                "Open a user-authorized web address in the system default external browser.",
                r#"{"type":"object","properties":{"url":{"type":"string"}},"required":["url"],"additionalProperties":false}"#,
                AgentToolRisk::ExternallyVisible,
            ),
            agent_tool(
                "browser.capture",
                "Capture the current embedded Browser page and return its dimensions so the user can inspect it in Hiveory.",
                r#"{"type":"object","properties":{"browser_id":{"type":"string"}},"required":["browser_id"],"additionalProperties":false}"#,
                AgentToolRisk::ReadOnly,
            ),
        ]
    }

    /// Open a browser requested by a coding CLI and bind it to a real Code
    /// workspace pane.  The old bridge only created a hidden native WebView;
    /// without a persisted Preview node the renderer had nothing to mount,
    /// so an agent could call the browser tools but the user could not see or
    /// interact with the result.
    async fn open_cli_browser(
        &self,
        browser_id: String,
        workspace_id: String,
        url: String,
    ) -> Result<String, String> {
        let normalized_url = browser::normalize_browser_input(&url)?;
        let was_open = self.manager.snapshot(&browser_id)?.is_some();
        let request = BrowserOpenRequest {
            browser_id: browser_id.clone(),
            workspace_id: workspace_id.clone(),
            url: normalized_url.to_string(),
        };
        let manager = self.manager.clone();
        let app = self.app.clone();
        let state = self
            .main_thread(move || manager.open(&app, &request))
            .await?;

        let bound = self
            .bind_cli_browser_pane(&browser_id, &workspace_id, &normalized_url)
            .await;
        let (layout, preview) = match bound {
            Ok(value) => value,
            Err(error) => {
                if !was_open {
                    let manager = self.manager.clone();
                    let browser_id_for_close = browser_id.clone();
                    let _ = self
                        .main_thread(move || manager.close(&browser_id_for_close))
                        .await;
                }
                return Err(error);
            }
        };

        let _ = self.app.emit_to(
            "main",
            CLI_BROWSER_PANE_OPENED_EVENT,
            CliBrowserPaneOpenedEvent { layout, preview },
        );
        serde_json::to_string(&state).map_err(|error| error.to_string())
    }

    async fn bind_cli_browser_pane(
        &self,
        browser_id: &str,
        workspace_id: &str,
        url: &url::Url,
    ) -> Result<(CodePaneLayout, CodePreviewSummary), String> {
        self.code_workspaces
            .require(
                workspace_id,
                hiveory_protocol::CodeWorkspaceCapability::OpenPreview,
            )
            .map_err(|error| error.to_string())?;

        let preview = CodePreviewSummary {
            id: browser_id.to_owned(),
            workspace_id: workspace_id.to_owned(),
            url: url.to_string(),
            origin: url.origin().ascii_serialization(),
            state: CodePreviewState::Open,
        };

        for _ in 0..4 {
            let current = self
                .persistence
                .code_layout(workspace_id)
                .await
                .map_err(|error| error.to_string())?
                .filter(|layout| layout.workspace_id == workspace_id)
                .unwrap_or_else(|| default_layout(workspace_id));

            // A browser pane may already be mounted when an agent reconnects
            // after a reload.  Refresh its durable URL and focus it without
            // adding a duplicate leaf.
            if let Some(existing_pane_id) = current.nodes.iter().find_map(|node| {
                (node.kind == CodePaneKind::Preview
                    && node.resource_id.as_deref() == Some(browser_id))
                .then_some(node.pane_id.clone())
            }) {
                let mut focused_layout = current.clone();
                focused_layout.focused_pane_id = Some(existing_pane_id);
                if focused_layout.focused_pane_id != current.focused_pane_id {
                    validate_layout(&focused_layout).map_err(|error| error.to_string())?;
                    match self
                        .persistence
                        .mutate_code_layout(workspace_id, current.revision, &focused_layout)
                        .await
                    {
                        Ok(saved_layout) => {
                            self.persistence
                                .save_code_preview(&preview, now_ms())
                                .await
                                .map_err(|error| error.to_string())?;
                            return Ok((saved_layout, preview));
                        }
                        Err(error) if error.to_string().contains("layout_conflict") => continue,
                        Err(error) => return Err(error.to_string()),
                    }
                } else {
                    self.persistence
                        .save_code_preview(&preview, now_ms())
                        .await
                        .map_err(|error| error.to_string())?;
                    return Ok((current, preview));
                }
            }

            let target_id = if is_empty_workspace_layout(&current) {
                current.root_id.clone()
            } else {
                current
                    .focused_pane_id
                    .as_deref()
                    .filter(|pane_id| {
                        current
                            .nodes
                            .iter()
                            .any(|node| node.pane_id == *pane_id && node.children.is_empty())
                    })
                    .map(ToOwned::to_owned)
                    .or_else(|| visual_leaf_order(&current).into_iter().next())
                    .ok_or_else(|| {
                        "The workspace has no available pane for the Browser.".to_owned()
                    })?
            };

            let mut next = if is_empty_workspace_layout(&current) {
                current.clone()
            } else {
                split_pane(&current, &target_id, CodePanePlacement::Right)
                    .map_err(|error| error.to_string())?
            };
            let pane_id = if is_empty_workspace_layout(&current) {
                target_id
            } else {
                let existing = current
                    .nodes
                    .iter()
                    .map(|node| node.pane_id.as_str())
                    .collect::<HashSet<_>>();
                next.nodes
                    .iter()
                    .find(|node| {
                        node.children.is_empty() && !existing.contains(node.pane_id.as_str())
                    })
                    .map(|node| node.pane_id.clone())
                    .ok_or_else(|| "The workspace pane could not be created.".to_owned())?
            };
            let node = next
                .nodes
                .iter_mut()
                .find(|node| node.pane_id == pane_id)
                .ok_or_else(|| {
                    "The workspace pane could not be found after splitting.".to_owned()
                })?;
            node.kind = CodePaneKind::Preview;
            node.resource_id = Some(browser_id.to_owned());
            node.title = Some(url.host_str().unwrap_or("Browser").to_owned());
            next.focused_pane_id = Some(pane_id);
            validate_layout(&next).map_err(|error| error.to_string())?;

            match self
                .persistence
                .mutate_code_layout(workspace_id, current.revision, &next)
                .await
            {
                Ok(saved_layout) => {
                    self.persistence
                        .save_code_preview(&preview, now_ms())
                        .await
                        .map_err(|error| error.to_string())?;
                    return Ok((saved_layout, preview));
                }
                Err(error) if error.to_string().contains("layout_conflict") => continue,
                Err(error) => return Err(error.to_string()),
            }
        }

        Err(
            "The workspace changed while the Browser pane was opening. Try the request again."
                .to_owned(),
        )
    }

    /// Reconnect a browser resource that was persisted with the workspace but
    /// has not been materialized in this desktop process yet.  This happens
    /// after a renderer reload or when a CLI starts before the Preview pane has
    /// mounted.  Keeping the recovery here makes every browser tool usable in
    /// either order instead of requiring the model to guess that `browser.open`
    /// must be called first.
    async fn ensure_cli_browser_entry(&self, browser_id: &str) -> Result<(), String> {
        if self.manager.snapshot(browser_id)?.is_some() {
            return Ok(());
        }
        let Some(workspace_id) = self.default_workspace_id.as_deref() else {
            return Err("The Browser pane is not open. Call browser.open first.".to_owned());
        };
        let preview = self
            .persistence
            .code_previews(workspace_id)
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|preview| preview.id == browser_id && preview.state == CodePreviewState::Open)
            .ok_or_else(|| {
                "The Browser pane is not open. Call browser.open with a URL first.".to_owned()
            })?;
        self.open_cli_browser(browser_id.to_owned(), workspace_id.to_owned(), preview.url)
            .await
            .map(|_| ())
    }

    async fn main_thread<T, F>(&self, operation: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, String> + Send + 'static,
    {
        run_browser_on_main_thread(self.app.clone(), operation)
            .await
            .map_err(|error| error.message)
    }

    async fn execute(&self, name: &str, arguments_json: &str) -> Result<String, String> {
        if !self.is_enabled().await {
            return Err("Browser Use is disabled in Settings. Enable it before asking an agent to drive a browser.".to_owned());
        }
        let args: Value = serde_json::from_str(arguments_json)
            .map_err(|_| "browser tool arguments are not valid JSON".to_owned())?;
        if name == "browser.open_external_url" {
            let url = browser_argument(&args, "url")?;
            let opened = self.manager.open_external_url(&url)?;
            return Ok(json!({ "opened": opened, "url": url }).to_string());
        }
        let browser_id = browser_argument(&args, "browser_id")?;
        if name != "browser.open" {
            if let Err(error) = self.ensure_cli_browser_entry(&browser_id).await {
                // Some CLI tool planners begin with state/snapshot and then
                // issue navigate without an explicit open call.  A direct
                // navigate still contains enough information to materialize
                // the requested pane, so recover that sequence for sessions
                // that own a workspace instead of returning a dead resource
                // error.
                if name == "browser.navigate" {
                    let workspace_id = self.default_workspace_id.clone().ok_or(error.clone())?;
                    let url = browser_argument(&args, "url")?;
                    return self.open_cli_browser(browser_id, workspace_id, url).await;
                }
                return Err(error);
            }
        }
        match name {
            "browser.snapshot" => {
                let expression = browser_snapshot_expression().to_owned();
                let browser_id = browser_id.clone();
                let mut snapshot = None;
                let mut last_error = None;
                // A page can still be attaching immediately after `browser.open`,
                // but retrying eight five-second CDP waits makes a transient page
                // state look like a hung CLI session.  One bounded retry gives the
                // WebView a chance to finish attaching without holding the MCP
                // request open for tens of seconds.
                for attempt in 0..2 {
                    let expression = expression.clone();
                    let browser_id = browser_id.clone();
                    match self.manager.evaluate_json(&browser_id, &expression) {
                        Ok(value) => {
                            snapshot = Some(value);
                            break;
                        }
                        Err(error) => {
                            last_error = Some(error);
                            if attempt == 0 {
                                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                            }
                        }
                    }
                }
                let snapshot = snapshot.ok_or_else(|| {
                    last_error.unwrap_or_else(|| {
                        "The Browser snapshot did not return a page value.".to_owned()
                    })
                })?;
                let result = snapshot
                    .get("result")
                    .and_then(|value| value.get("result"))
                    .and_then(|value| value.get("value"))
                    .cloned()
                    .ok_or_else(|| {
                        "The Browser snapshot did not return a page value.".to_owned()
                    })?;
                serde_json::to_string(&result).map_err(|error| error.to_string())
            }
            "browser.state" => {
                let state = self
                    .manager
                    .snapshot(&browser_id)?
                    .ok_or_else(|| "The Browser pane is not open.".to_owned())?;
                serde_json::to_string(&state).map_err(|error| error.to_string())
            }
            "browser.open" => {
                let workspace_id = browser_argument(&args, "workspace_id")?;
                let url = browser_argument(&args, "url")?;
                self.open_cli_browser(browser_id, workspace_id, url).await
            }
            "browser.navigate" => {
                let url = browser_argument(&args, "url")?;
                let manager = self.manager.clone();
                let app = self.app.clone();
                let request = BrowserNavigationRequest { browser_id, url };
                let state = self
                    .main_thread(move || manager.navigate(&app, &request))
                    .await?;
                serde_json::to_string(&state).map_err(|error| error.to_string())
            }
            "browser.back" | "browser.forward" | "browser.reload" => {
                let manager = self.manager.clone();
                let app = self.app.clone();
                let action = name.to_owned();
                let state = self
                    .main_thread(move || match action.as_str() {
                        "browser.back" => manager.back(&app, &browser_id),
                        "browser.forward" => manager.forward(&app, &browser_id),
                        _ => manager.reload(&app, &browser_id),
                    })
                    .await?;
                serde_json::to_string(&state).map_err(|error| error.to_string())
            }
            "browser.click" | "browser.fill" | "browser.press" | "browser.scroll" => {
                let script = match name {
                    "browser.click" => {
                        let selector = browser_js_string(
                            &browser_argument(&args, "selector")?,
                            "selector",
                            512,
                        )?;
                        format!("(() => {{ const element = document.querySelector({selector}); if (!element) throw new Error('Element not found.'); element.click(); }})()")
                    }
                    "browser.fill" => {
                        let selector = browser_js_string(
                            &browser_argument(&args, "selector")?,
                            "selector",
                            512,
                        )?;
                        let value =
                            browser_js_string(&browser_argument(&args, "value")?, "value", 8_000)?;
                        format!("(() => {{ const element = document.querySelector({selector}); if (!element) throw new Error('Element not found.'); const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set; if (setter) setter.call(element, {value}); else element.value = {value}; element.dispatchEvent(new Event('input', {{ bubbles: true }})); element.dispatchEvent(new Event('change', {{ bubbles: true }})); }})()")
                    }
                    "browser.press" => {
                        let selector = browser_js_string(
                            &browser_argument(&args, "selector")?,
                            "selector",
                            512,
                        )?;
                        let key = browser_js_string(&browser_argument(&args, "key")?, "key", 80)?;
                        format!("(() => {{ const element = document.querySelector({selector}); if (!element) throw new Error('Element not found.'); element.dispatchEvent(new KeyboardEvent('keydown', {{ key: {key}, bubbles: true }})); element.dispatchEvent(new KeyboardEvent('keyup', {{ key: {key}, bubbles: true }})); }})()")
                    }
                    _ => {
                        let raw = args
                            .get("delta_y")
                            .and_then(Value::as_f64)
                            .ok_or_else(|| "delta_y is required".to_owned())?;
                        let delta = raw.clamp(-10_000.0, 10_000.0);
                        format!("window.scrollBy({{ left: 0, top: {delta}, behavior: 'smooth' }})")
                    }
                };
                self.manager.evaluate(&browser_id, &script)?;
                Ok(json!({ "dispatched": true, "action": name }).to_string())
            }
            "browser.open_external" => {
                let request = BrowserIdRequest { browser_id };
                let opened = self.manager.open_external(&request)?;
                Ok(json!({ "opened": opened }).to_string())
            }
            "browser.capture" => {
                let request = BrowserIdRequest { browser_id };
                let frame = self.manager.capture_frame(&request)?;
                Ok(
                    json!({ "captured": true, "width": frame.width, "height": frame.height })
                        .to_string(),
                )
            }
            _ => Err("browser tool is not available".to_owned()),
        }
    }
}

fn canonical_cli_tool_alias(name: &str) -> Option<&'static str> {
    Some(match name {
        "hiveory_browser_snapshot" => "browser.snapshot",
        "hiveory_browser_state" => "browser.state",
        "hiveory_browser_open" => "browser.open",
        "hiveory_browser_navigate" => "browser.navigate",
        "hiveory_browser_back" => "browser.back",
        "hiveory_browser_forward" => "browser.forward",
        "hiveory_browser_reload" => "browser.reload",
        "hiveory_browser_click" => "browser.click",
        "hiveory_browser_fill" => "browser.fill",
        "hiveory_browser_press" => "browser.press",
        "hiveory_browser_scroll" => "browser.scroll",
        "hiveory_browser_open_external" => "browser.open_external",
        "hiveory_browser_open_external_url" => "browser.open_external_url",
        "hiveory_browser_capture" => "browser.capture",
        "hiveory_computer_capabilities" => "computer.capabilities",
        "hiveory_computer_list_apps" => "computer.list_apps",
        "hiveory_computer_list_windows" => "computer.list_windows",
        "hiveory_computer_snapshot" => "computer.snapshot",
        "hiveory_computer_action" => "computer.action",
        "hiveory_skills_list" => "skills.list",
        "hiveory_skills_read" => "skills.read",
        "hiveory_session_status" => "session.status",
        "hiveory_session_capabilities" => "session.capabilities",
        "hiveory_session_current_context" => "session.current_context",
        "hiveory_orchestration_list_runs" => "orchestration.list_runs",
        "hiveory_orchestration_get_run" => "orchestration.get_run",
        "hiveory_orchestration_create_run" => "orchestration.create_run",
        "hiveory_orchestration_create_task" => "orchestration.create_task",
        "hiveory_orchestration_start_run" => "orchestration.start_run",
        "hiveory_orchestration_send_message" => "orchestration.send_message",
        "hiveory_orchestration_wait" => "orchestration.wait",
        "hiveory_orchestration_list_participants" => "orchestration.list_participants",
        "hiveory_orchestration_assign_task" => "orchestration.assign_task",
        "hiveory_orchestration_report_completion" => "orchestration.report_completion",
        _ => return None,
    })
}

impl HiveoryCliSessionTools {
    fn participant_address(&self) -> String {
        if self.session_id.starts_with("cli-worker-") {
            format!("worker:{}", self.session_id)
        } else {
            format!("coordinator:{}", self.session_id)
        }
    }

    async fn canonical_tool_name(&self, name: &str) -> String {
        if let Some(alias) = canonical_cli_tool_alias(name) {
            return alias.to_owned();
        }
        let Some(alias) = name.strip_prefix("hiveory_") else {
            return name.to_owned();
        };
        if !alias.starts_with("plugin_") {
            return name.to_owned();
        }
        let definitions = self.plugin.session_definitions().await.unwrap_or_default();
        definitions
            .into_iter()
            .find(|definition| format!("hiveory_{}", definition.name.replace('.', "_")) == name)
            .map(|definition| definition.name)
            .unwrap_or_else(|| name.to_owned())
    }

    async fn definitions(&self) -> Result<Vec<AgentToolDefinition>, String> {
        let mut definitions = self
            .plugin
            .session_definitions()
            .await
            .map_err(|error| error.to_string())?;
        let mut browser_definitions = self.browser.definitions().await;
        if let Some(open) = browser_definitions
            .iter_mut()
            .find(|definition| definition.name == "browser.open")
        {
            open.description = "Open an embedded Hiveory Browser pane in this workspace. Supply only url to let Hiveory create a new browser pane; browser_id and workspace_id are optional when reconnecting an existing pane.".to_owned();
            open.input_schema_json = r#"{"type":"object","properties":{"browser_id":{"type":"string"},"workspace_id":{"type":"string"},"url":{"type":"string"}},"required":["url"],"additionalProperties":false}"#.to_owned();
        }
        definitions.extend(browser_definitions);
        definitions.extend(self.computer.definitions().await);
        definitions.extend(cli_session_management_definitions());
        Ok(definitions)
    }

    async fn execute(&self, name: &str, arguments: &Value) -> Result<String, String> {
        let name = self.canonical_tool_name(name).await;
        let arguments_json = serde_json::to_string(arguments)
            .map_err(|error| format!("tool arguments could not be encoded: {error}"))?;
        if name.starts_with("plugin.") {
            self.plugin
                .execute_session(&self.session_id, &name, &arguments_json)
                .await
                .map_err(|error| error.to_string())
        } else if name.starts_with("browser.") {
            let arguments_json = if name == "browser.open" {
                let mut browser_arguments = arguments.clone();
                let object = browser_arguments
                    .as_object_mut()
                    .ok_or_else(|| "browser tool arguments must be an object".to_owned())?;
                object
                    .entry("browser_id")
                    .or_insert_with(|| Value::String(format!("browser-{}", uuid::Uuid::now_v7())));
                object
                    .entry("workspace_id")
                    .or_insert_with(|| Value::String(self.workspace_id.clone()));
                serde_json::to_string(&browser_arguments)
                    .map_err(|error| format!("tool arguments could not be encoded: {error}"))?
            } else {
                arguments_json
            };
            self.browser.execute(&name, &arguments_json).await
        } else if name.starts_with("computer.") {
            self.computer.execute(&name, &arguments_json).await
        } else if name.starts_with("agent_panes.") {
            match name.as_str() {
                "agent_panes.list" => serde_json::to_string(&self.agent_panes.list().await?)
                    .map_err(|error| error.to_string()),
                "agent_panes.open" => {
                    serde_json::to_string(&self.agent_panes.open(arguments).await?)
                        .map_err(|error| error.to_string())
                }
                "agent_panes.rename" => {
                    serde_json::to_string(&self.agent_panes.rename(arguments).await?)
                        .map_err(|error| error.to_string())
                }
                _ => Err("agent-pane tool is not available".to_owned()),
            }
        } else if name.starts_with("session.") {
            self.execute_session(&name, arguments).await
        } else if name.starts_with("skills.") {
            self.execute_skill(&name, arguments).await
        } else if name.starts_with("orchestration.") {
            self.execute_orchestration(&name, arguments).await
        } else {
            Err("This Hiveory CLI session does not provide that tool.".to_owned())
        }
    }

    async fn execute_session(&self, name: &str, _arguments: &Value) -> Result<String, String> {
        match name {
            "session.status" | "session.capabilities" | "session.current_context" => {
                serde_json::to_string(&json!({
                    "status": "ready",
                    "session_id": self.session_id,
                    "workspace_id": self.workspace_id,
                    "participant_address": self.participant_address(),
                    "orchestration_tools": [
                        "orchestration.create_run", "orchestration.create_task",
                        "orchestration.start_run", "orchestration.open_worker_pane",
                        "orchestration.assign_task", "orchestration.report_completion",
                        "orchestration.send_message", "orchestration.inbox",
                        "orchestration.wait", "orchestration.acknowledge_message",
                        "orchestration.list_participants"
                    ],
                    "guidance": "Hiveory orchestration is available in this pane. Call this status tool before reporting that orchestration is unavailable."
                }))
                .map_err(|error| error.to_string())
            }
            _ => Err("session tool is not available".to_owned()),
        }
    }

    async fn execute_skill(&self, name: &str, arguments: &Value) -> Result<String, String> {
        match name {
            "skills.list" => {
                let catalog = self
                    .skills
                    .catalog()
                    .await
                    .map_err(|error| error.to_string())?;
                serde_json::to_string(
                    &catalog
                        .into_iter()
                        .filter(|skill| skill.valid)
                        .collect::<Vec<_>>(),
                )
                .map_err(|error| error.to_string())
            }
            "skills.read" => {
                let skill_id = arguments
                    .get("skill_id")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| "skill_id is required".to_owned())?;
                let package = self
                    .skills
                    .skill_package(skill_id)
                    .await
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| "skill was not found".to_owned())?;
                if !package.0.valid {
                    return Err("skill is not valid and cannot be used".to_owned());
                }
                serde_json::to_string(&json!({ "skill": package.0, "instructions": package.1 }))
                    .map_err(|error| error.to_string())
            }
            _ => Err("skill tool is not available".to_owned()),
        }
    }

    async fn execute_orchestration(&self, name: &str, arguments: &Value) -> Result<String, String> {
        let result = match name {
            "orchestration.list_runs" => {
                let workspace_id = arguments.get("workspace_id").and_then(Value::as_str);
                if workspace_id.is_some_and(|workspace_id| workspace_id != self.workspace_id) {
                    return Err(
                        "CLI sessions can only inspect orchestration runs in their own workspace."
                            .to_owned(),
                    );
                }
                serde_json::to_value(
                    self.orchestration
                        .runs(Some(&self.workspace_id))
                        .await
                        .map_err(|error| error.to_string())?,
                )
            }
            "orchestration.get_run" => {
                let run_id = required_cli_string(arguments, "run_id")?;
                let detail = self
                    .orchestration
                    .detail(run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if detail.summary.workspace_id != self.workspace_id {
                    return Err("The requested run belongs to a different workspace.".to_owned());
                }
                serde_json::to_value(detail)
            }
            "orchestration.create_run" => {
                let mut request_arguments = arguments.clone();
                request_arguments
                    .as_object_mut()
                    .ok_or_else(|| "run arguments must be an object".to_owned())?
                    .entry("workspace_id")
                    .or_insert_with(|| Value::String(self.workspace_id.clone()));
                let mut request = serde_json::from_value::<CodeRunCreateRequest>(request_arguments)
                    .map_err(|error| format!("invalid create-run request: {error}"))?;
                if request.workspace_id.is_empty() {
                    request.workspace_id = self.workspace_id.clone();
                }
                if request.workspace_id != self.workspace_id {
                    return Err(
                        "CLI sessions can only create runs in their own workspace.".to_owned()
                    );
                }
                if request.coordinator_id.is_none() {
                    request.coordinator_id = Some(self.session_id.clone());
                }
                serde_json::to_value(
                    self.orchestration
                        .create_run(&request)
                        .await
                        .map_err(|error| error.to_string())?,
                )
            }
            "orchestration.create_task" => {
                let mut request_arguments = arguments.clone();
                request_arguments
                    .as_object_mut()
                    .ok_or_else(|| "task arguments must be an object".to_owned())?
                    .entry("depends_on")
                    .or_insert_with(|| Value::Array(Vec::new()));
                let request = serde_json::from_value::<CodeTaskCreateRequest>(request_arguments)
                    .map_err(|error| format!("invalid create-task request: {error}"))?;
                let detail = self
                    .orchestration
                    .detail(&request.run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if detail.summary.workspace_id != self.workspace_id {
                    return Err("The requested run belongs to a different workspace.".to_owned());
                }
                serde_json::to_value(
                    self.orchestration
                        .create_task(&request)
                        .await
                        .map_err(|error| error.to_string())?,
                )
            }
            "orchestration.start_run" => {
                let request = CodeRunRequest {
                    run_id: required_cli_string(arguments, "run_id")?.to_owned(),
                };
                let detail = self
                    .orchestration
                    .detail(&request.run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if detail.summary.workspace_id != self.workspace_id {
                    return Err("The requested run belongs to a different workspace.".to_owned());
                }
                serde_json::to_value(
                    self.orchestration
                        .start_run(&request)
                        .await
                        .map_err(|error| error.to_string())?,
                )
            }
            "orchestration.send_message" => {
                let mut request_arguments = arguments.clone();
                request_arguments
                    .as_object_mut()
                    .ok_or_else(|| "mailbox arguments must be an object".to_owned())?
                    .entry("sender_address")
                    .or_insert_with(|| Value::String(self.participant_address()));
                let request = serde_json::from_value::<CodeMailboxSendRequest>(request_arguments)
                    .map_err(|error| format!("invalid mailbox request: {error}"))?;
                let detail = self
                    .orchestration
                    .detail(&request.run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if detail.summary.workspace_id != self.workspace_id {
                    return Err("The requested run belongs to a different workspace.".to_owned());
                }
                serde_json::to_value(
                    self.orchestration
                        .send_mailbox_message(&request)
                        .await
                        .map_err(|error| error.to_string())?,
                )
            }
            "orchestration.inbox" => {
                let mut query_arguments = arguments.clone();
                query_arguments
                    .as_object_mut()
                    .ok_or_else(|| "inbox arguments must be an object".to_owned())?
                    .entry("recipient_address")
                    .or_insert_with(|| Value::String(self.participant_address()));
                let request = serde_json::from_value::<CodeMailboxQuery>(query_arguments)
                    .map_err(|error| format!("invalid inbox query: {error}"))?;
                let detail = self
                    .orchestration
                    .detail(&request.run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if detail.summary.workspace_id != self.workspace_id {
                    return Err("The requested run belongs to a different workspace.".to_owned());
                }
                serde_json::to_value(
                    self.orchestration
                        .mailbox(&request)
                        .await
                        .map_err(|error| error.to_string())?,
                )
            }
            "orchestration.acknowledge_message" => {
                let mut acknowledgement_arguments = arguments.clone();
                acknowledgement_arguments
                    .as_object_mut()
                    .ok_or_else(|| "acknowledgement arguments must be an object".to_owned())?
                    .entry("recipient_address")
                    .or_insert_with(|| Value::String(self.participant_address()));
                let request =
                    serde_json::from_value::<CodeMailboxAckRequest>(acknowledgement_arguments)
                        .map_err(|error| format!("invalid mailbox acknowledgement: {error}"))?;
                let detail = self
                    .orchestration
                    .detail(&request.run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if detail.summary.workspace_id != self.workspace_id {
                    return Err("The requested run belongs to a different workspace.".to_owned());
                }
                serde_json::to_value(
                    self.orchestration
                        .acknowledge_mailbox(&request)
                        .await
                        .map_err(|error| error.to_string())?,
                )
            }
            "orchestration.list_workers" => serde_json::to_value(self.agent_panes.list().await?),
            "orchestration.list_participants" => {
                let run_id = required_cli_string(arguments, "run_id")?;
                let detail = self
                    .orchestration
                    .detail(run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if detail.summary.workspace_id != self.workspace_id {
                    return Err("The requested run belongs to a different workspace.".to_owned());
                }
                serde_json::to_value(
                    self.orchestration
                        .participants(run_id)
                        .await
                        .map_err(|error| error.to_string())?,
                )
            }
            "orchestration.wait" => {
                let run_id = required_cli_string(arguments, "run_id")?.to_owned();
                let detail = self
                    .orchestration
                    .detail(&run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if detail.summary.workspace_id != self.workspace_id {
                    return Err("The requested run belongs to a different workspace.".to_owned());
                }
                let recipient_address = arguments
                    .get("recipient_address")
                    .and_then(Value::as_str)
                    .filter(|address| !address.trim().is_empty())
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| self.participant_address());
                let timeout_ms = arguments
                    .get("timeout_ms")
                    .and_then(Value::as_u64)
                    .unwrap_or(30_000)
                    .clamp(1, 60_000);
                let query = CodeMailboxQuery {
                    run_id: run_id.clone(),
                    recipient_address,
                    include_acknowledged: false,
                    limit: Some(50),
                };
                let mut events = self.orchestration.subscribe();
                let wait_for_delivery = async {
                    loop {
                        let deliveries = self
                            .orchestration
                            .mailbox(&query)
                            .await
                            .map_err(|error| error.to_string())?;
                        if !deliveries.is_empty() {
                            return Ok(json!({ "timed_out": false, "deliveries": deliveries }));
                        }
                        match events.recv().await {
                            Ok(event) if event.run_id == run_id => {}
                            Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                            Err(broadcast::error::RecvError::Closed) => {
                                return Err("orchestration event stream closed".to_owned())
                            }
                        }
                    }
                };
                Ok(
                    match timeout(Duration::from_millis(timeout_ms), wait_for_delivery).await {
                        Ok(result) => result?,
                        Err(_) => json!({ "timed_out": true, "deliveries": [] }),
                    },
                )
            }
            "orchestration.assign_task" => {
                let run_id = required_cli_string(arguments, "run_id")?.to_owned();
                let task_id = required_cli_string(arguments, "task_id")?.to_owned();
                let detail = self
                    .orchestration
                    .detail(&run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if detail.summary.workspace_id != self.workspace_id {
                    return Err("The requested run belongs to a different workspace.".to_owned());
                }
                let task = detail
                    .tasks
                    .iter()
                    .find(|task| task.id == task_id)
                    .cloned()
                    .ok_or_else(|| "The requested task was not found.".to_owned())?;
                let opened = self.agent_panes.open(arguments).await?;
                let recipient_address = opened
                    .get("address")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "The worker pane did not return a mailbox address.".to_owned())?
                    .to_owned();
                if let Err(error) = self
                    .orchestration
                    .start_visible_task(&run_id, &task_id)
                    .await
                {
                    if let Some(terminal_id) = opened
                        .get("terminal")
                        .and_then(|terminal| terminal.get("id"))
                        .and_then(Value::as_str)
                    {
                        let _ = self
                            .agent_panes
                            .foundation
                            .terminal_host
                            .stop(&CodeTerminalStopRequest {
                                terminal_id: terminal_id.to_owned(),
                                force: true,
                            })
                            .await;
                    }
                    return Err(error.to_string());
                }
                let assignment = json!({
                    "type": "assignment",
                    "run_id": &run_id,
                    "task_id": &task_id,
                    "title": &task.title,
                    "specification": &task.specification,
                    "sender_address": self.participant_address(),
                    "completion_instruction": "When complete, call orchestration.report_completion with this run_id, task_id, and a concise summary. Use orchestration.inbox or orchestration.wait for follow-up messages."
                });
                let delivery = self
                    .orchestration
                    .send_mailbox_message(&CodeMailboxSendRequest {
                        run_id: run_id.clone(),
                        sender_address: self.participant_address(),
                        recipient_address: recipient_address.clone(),
                        kind: hiveory_protocol::CodeOrchestrationMessageKind::Status,
                        payload: assignment.to_string(),
                        thread_id: Some(format!("task-{task_id}")),
                        client_request_id: Some(format!("assign-{task_id}-{}", uuid::Uuid::now_v7())),
                    })
                    .await
                    .map_err(|error| error.to_string())?;
                if let Some(terminal_id) = opened
                    .get("terminal")
                    .and_then(|terminal| terminal.get("id"))
                    .and_then(Value::as_str)
                {
                    let terminal_host = self.agent_panes.foundation.terminal_host.clone();
                    let terminal_id = terminal_id.to_owned();
                    let prompt = format!(
                        "You are now assigned a Hiveory task. Call session.status, then orchestration.inbox with run_id {run_id:?}. Read and acknowledge the assignment before working."
                    );
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(750)).await;
                        let _ = terminal_host
                            .write(&CodeTerminalInputRequest {
                                terminal_id,
                                data_base64: STANDARD.encode(format!("{prompt}\n")),
                            })
                            .await;
                    });
                }
                Ok(json!({
                    "run_id": run_id,
                    "task_id": task_id,
                    "worker": opened,
                    "delivery": delivery,
                }))
            }
            "orchestration.report_completion" => {
                let run_id = required_cli_string(arguments, "run_id")?.to_owned();
                let task_id = required_cli_string(arguments, "task_id")?.to_owned();
                let summary = required_cli_string(arguments, "summary")?.to_owned();
                let existing = self
                    .orchestration
                    .detail(&run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if existing.summary.workspace_id != self.workspace_id {
                    return Err("The requested run belongs to a different workspace.".to_owned());
                }
                let detail = self
                    .orchestration
                    .complete_visible_task(&run_id, &task_id, &summary)
                    .await
                    .map_err(|error| error.to_string())?;
                let recipient_address = arguments
                    .get("recipient_address")
                    .and_then(Value::as_str)
                    .filter(|address| !address.trim().is_empty())
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("coordinator:{}", detail.summary.coordinator_id));
                let delivery = self
                    .orchestration
                    .send_mailbox_message(&CodeMailboxSendRequest {
                        run_id: run_id.clone(),
                        sender_address: self.participant_address(),
                        recipient_address,
                        kind: hiveory_protocol::CodeOrchestrationMessageKind::Completion,
                        payload: summary,
                        thread_id: Some(format!("task-{task_id}")),
                        client_request_id: Some(format!("complete-{task_id}-{}", uuid::Uuid::now_v7())),
                    })
                    .await
                    .map_err(|error| error.to_string())?;
                serde_json::to_value(json!({ "run": detail, "delivery": delivery }))
            }
            "orchestration.open_worker_pane" => {
                serde_json::to_value(self.agent_panes.open(arguments).await?)
            }
            "orchestration.adapter_catalog" => serde_json::to_value(
                self.agent_panes
                    .foundation
                    .code_runtime
                    .chat_engines()
                    .await,
            ),
            _ => return Err("orchestration tool is not available".to_owned()),
        }
        .map_err(|error| error.to_string())?;
        serde_json::to_string(&result).map_err(|error| error.to_string())
    }
}

fn required_cli_string<'a>(arguments: &'a Value, name: &str) -> Result<&'a str, String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{name} is required"))
}

fn cli_session_management_definitions() -> Vec<AgentToolDefinition> {
    const EMPTY: &str = r#"{"type":"object","additionalProperties":false}"#;
    const RUN_ID: &str = r#"{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"],"additionalProperties":false}"#;
    const SKILL_ID: &str = r#"{"type":"object","properties":{"skill_id":{"type":"string"}},"required":["skill_id"],"additionalProperties":false}"#;
    const RUN_LIST: &str = r#"{"type":"object","properties":{"workspace_id":{"type":"string"}},"additionalProperties":false}"#;
    const WAIT: &str = r#"{"type":"object","properties":{"run_id":{"type":"string"},"recipient_address":{"type":"string"},"timeout_ms":{"type":"integer","minimum":1,"maximum":60000}},"required":["run_id"],"additionalProperties":false}"#;
    const ASSIGN: &str = r#"{"type":"object","properties":{"run_id":{"type":"string"},"task_id":{"type":"string"},"adapter_id":{"type":"string","enum":["codex-cli","claude-code","antigravity","opencode","codex","claude","agy","open-code"]},"model":{"type":"string"},"title":{"type":"string"},"reuse_pane_id":{"type":"string"},"agent_launch_mode":{"type":"string","enum":["standard","yolo"]},"cols":{"type":"integer","minimum":20,"maximum":500},"rows":{"type":"integer","minimum":10,"maximum":500}},"required":["run_id","task_id"],"additionalProperties":false}"#;
    const COMPLETE: &str = r#"{"type":"object","properties":{"run_id":{"type":"string"},"task_id":{"type":"string"},"summary":{"type":"string"},"recipient_address":{"type":"string"}},"required":["run_id","task_id","summary"],"additionalProperties":false}"#;
    const CREATE_RUN: &str = r#"{"type":"object","properties":{"workspace_id":{"type":"string"},"title":{"type":"string"},"objective":{"type":"string"},"review_policy":{"type":"string","enum":["manual","automatic"]},"concurrency_limit":{"type":"integer","minimum":1},"model":{"type":"string"},"coordinator_id":{"type":"string"},"adapter_id":{"type":"string"}},"required":["title","objective","review_policy"],"additionalProperties":false}"#;
    const CREATE_TASK: &str = r#"{"type":"object","properties":{"run_id":{"type":"string"},"client_id":{"type":"string"},"title":{"type":"string"},"specification":{"type":"string"},"depends_on":{"type":"array","items":{"type":"string"}}},"required":["run_id","title","specification"],"additionalProperties":false}"#;
    const MAILBOX: &str = r#"{"type":"object","properties":{"run_id":{"type":"string"},"sender_address":{"type":"string"},"recipient_address":{"type":"string"},"kind":{"type":"string","enum":["status","heartbeat","question","answer","escalation","progress","completion"]},"payload":{"type":"string"},"thread_id":{"type":"string"},"client_request_id":{"type":"string"}},"required":["run_id","recipient_address","kind","payload"],"additionalProperties":false}"#;
    const INBOX: &str = r#"{"type":"object","properties":{"run_id":{"type":"string"},"recipient_address":{"type":"string"},"include_acknowledged":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":200}},"required":["run_id"],"additionalProperties":false}"#;
    const ACK: &str = r#"{"type":"object","properties":{"run_id":{"type":"string"},"delivery_id":{"type":"string"},"recipient_address":{"type":"string"}},"required":["run_id","delivery_id"],"additionalProperties":false}"#;
    const OPEN_AGENT: &str = r#"{"type":"object","properties":{"adapter_id":{"type":"string","enum":["codex-cli","claude-code","antigravity","opencode","codex","claude","agy","open-code"]},"model":{"type":"string"},"title":{"type":"string"},"reuse_pane_id":{"type":"string"},"agent_launch_mode":{"type":"string","enum":["standard","yolo"]},"cols":{"type":"integer","minimum":20,"maximum":500},"rows":{"type":"integer","minimum":10,"maximum":500}},"additionalProperties":false}"#;
    const RENAME_AGENT: &str = r#"{"type":"object","properties":{"pane_id":{"type":"string","description":"Optional durable pane ID. Omit to rename the most recently opened coding-agent pane."},"title":{"type":"string"}},"required":["title"],"additionalProperties":false}"#;
    [
        (
            "session.status",
            "Confirm that this pane has a live Hiveory orchestration bridge and return its durable address and tool manifest. Call this before claiming orchestration is unavailable.",
            EMPTY,
            AgentToolRisk::ReadOnly,
        ),
        (
            "session.capabilities",
            "Return the Hiveory capabilities available to this CLI pane.",
            EMPTY,
            AgentToolRisk::ReadOnly,
        ),
        (
            "session.current_context",
            "Return this pane's session, workspace, and durable orchestration address.",
            EMPTY,
            AgentToolRisk::ReadOnly,
        ),
        (
            "skills.list",
            "List Hiveory skills that are valid for this CLI session.",
            EMPTY,
            AgentToolRisk::ReadOnly,
        ),
        (
            "skills.read",
            "Read the full instructions for one Hiveory skill by its ID.",
            SKILL_ID,
            AgentToolRisk::ReadOnly,
        ),
        (
            "orchestration.list_runs",
            "List Hiveory orchestration runs, optionally for one workspace.",
            RUN_LIST,
            AgentToolRisk::ReadOnly,
        ),
        (
            "orchestration.get_run",
            "Read an orchestration run, including its tasks, dispatches, and messages.",
            RUN_ID,
            AgentToolRisk::ReadOnly,
        ),
        (
            "orchestration.create_run",
            "Create a draft orchestration run in Hiveory. This changes workspace state.",
            CREATE_RUN,
            AgentToolRisk::InternalMutation,
        ),
        (
            "orchestration.create_task",
            "Add a task to a draft Hiveory orchestration run. This changes run state.",
            CREATE_TASK,
            AgentToolRisk::InternalMutation,
        ),
        (
            "orchestration.start_run",
            "Start an orchestration run after its tasks are ready. This launches worker agents.",
            RUN_ID,
            AgentToolRisk::FilesystemMutation,
        ),
        (
            "orchestration.send_message",
            "Send a mailbox message or handoff between agents in a Hiveory orchestration run.",
            MAILBOX,
            AgentToolRisk::InternalMutation,
        ),
        (
            "orchestration.inbox",
            "Read durable messages addressed to one orchestration participant. Workers must acknowledge deliveries after processing them.",
            INBOX,
            AgentToolRisk::ReadOnly,
        ),
        (
            "orchestration.wait",
            "Wait up to timeout_ms for unread durable messages addressed to this pane. This avoids polling and returns immediately if messages already exist.",
            WAIT,
            AgentToolRisk::ReadOnly,
        ),
        (
            "orchestration.acknowledge_message",
            "Acknowledge one durable orchestration mailbox delivery after it has been handled.",
            ACK,
            AgentToolRisk::InternalMutation,
        ),
        (
            "orchestration.adapter_catalog",
            "List installed coding-agent adapters and their available models only when the user did not specify an adapter or model.",
            EMPTY,
            AgentToolRisk::ReadOnly,
        ),
        (
            "orchestration.list_workers",
            "List visible Hiveory-managed coding-agent panes in this workspace and whether each may be safely reused.",
            EMPTY,
            AgentToolRisk::ReadOnly,
        ),
        (
            "orchestration.list_participants",
            "List the durable coordinator, worker, user, and system addresses in one orchestration run.",
            RUN_ID,
            AgentToolRisk::ReadOnly,
        ),
        (
            "orchestration.open_worker_pane",
            "Open a visible coding-agent worker pane in this workspace. By default this creates a new pane; reuse_pane_id is accepted only for an idle Hiveory-managed coding-agent pane.",
            OPEN_AGENT,
            AgentToolRisk::FilesystemMutation,
        ),
        (
            "orchestration.assign_task",
            "Open or reuse a visible worker pane, bind it to an existing ready task, and deliver a structured assignment through its durable mailbox.",
            ASSIGN,
            AgentToolRisk::FilesystemMutation,
        ),
        (
            "orchestration.report_completion",
            "Report completion for this pane's visible task, update task state, and send a durable completion message to the coordinator.",
            COMPLETE,
            AgentToolRisk::InternalMutation,
        ),
        (
            "agent_panes.list",
            "List visible Hiveory-managed coding-agent panes in this workspace.",
            EMPTY,
            AgentToolRisk::ReadOnly,
        ),
        (
            "agent_panes.open",
            "Open a visible coding-agent pane. For a direct user request with adapter, model, launch mode, or title, call this immediately with those values; do not inspect source files, skills, adapters, or existing panes first. Treat its returned pane_id and title as the durable record of the opened agent.",
            OPEN_AGENT,
            AgentToolRisk::FilesystemMutation,
        ),
        (
            "agent_panes.rename",
            "Rename a visible coding-agent pane and return the saved title. Omit pane_id for a request referring to the previous or most recently opened agent. Do not say the name changed until this tool succeeds.",
            RENAME_AGENT,
            AgentToolRisk::InternalMutation,
        ),
    ]
    .into_iter()
    .map(
        |(name, description, input_schema_json, risk)| AgentToolDefinition {
            name: name.to_owned(),
            description: description.to_owned(),
            input_schema_json: input_schema_json.to_owned(),
            risk,
        },
    )
    .collect()
}

fn start_cli_session_bridge(
    foundation: &HiveoryFoundation,
    app: tauri::AppHandle,
    browser: BrowserManager,
    session_id: String,
    workspace_id: String,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<CliSessionBridge, ApiError>> + Send>>
{
    let foundation = foundation.clone();
    Box::pin(async move {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|error| {
            application_error(
                "cli_session_bridge_unavailable",
                error.to_string(),
                RetryClass::Safe,
            )
        })?;
        let endpoint = listener.local_addr().map_err(|error| {
            application_error(
                "cli_session_bridge_unavailable",
                error.to_string(),
                RetryClass::Safe,
            )
        })?;
        let token = uuid::Uuid::now_v7().to_string();
        let tools = HiveoryCliSessionTools {
            plugin: foundation.plugin_runtime.clone(),
            agent_panes: HiveoryCliAgentPaneProvider {
                foundation: foundation.clone(),
                app: app.clone(),
                browser: browser.clone(),
                workspace_id: workspace_id.clone(),
            },
            browser: HiveoryBrowserToolProvider {
                app,
                manager: browser,
                persistence: foundation.persistence.clone(),
                code_workspaces: foundation.code_workspaces.clone(),
                default_workspace_id: Some(workspace_id.clone()),
            },
            computer: HiveoryComputerUseToolProvider {
                persistence: foundation.persistence.clone(),
            },
            skills: HiveoryAgentStore::new(foundation.persistence.clone()),
            orchestration: foundation.code_orchestration.clone(),
            session_id,
            workspace_id,
        };
        let expected_token = token.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let tools = tools.clone();
                let token = expected_token.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = handle_cli_session_bridge_connection(stream, &token, tools).await;
                });
            }
        });
        Ok(CliSessionBridge {
            endpoint: endpoint.to_string(),
            token,
        })
    })
}

async fn handle_cli_session_bridge_connection(
    stream: TcpStream,
    expected_token: &str,
    tools: HiveoryCliSessionTools,
) -> Result<(), String> {
    const MAX_BRIDGE_MESSAGE_BYTES: usize = 1024 * 1024;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let read = reader
        .read_line(&mut line)
        .await
        .map_err(|error| error.to_string())?;
    if read == 0 || line.len() > MAX_BRIDGE_MESSAGE_BYTES {
        return Ok(());
    }
    let response = match serde_json::from_str::<CliSessionBridgeRequest>(&line) {
        Ok(request) if request.token == expected_token => match request.method.as_str() {
            "tools/list" => match tools.definitions().await {
                Ok(definitions) => json!({ "ok": true, "tools": definitions }),
                Err(error) => json!({ "ok": false, "error": error }),
            },
            "tools/call" => {
                let name = request.name.unwrap_or_default();
                let arguments = request.arguments.unwrap_or_else(|| json!({}));
                match tools.execute(&name, &arguments).await {
                    Ok(output) => json!({ "ok": true, "output": output }),
                    Err(error) => json!({ "ok": false, "error": error }),
                }
            }
            _ => json!({ "ok": false, "error": "unknown bridge method" }),
        },
        Ok(_) => json!({ "ok": false, "error": "CLI session bridge authentication failed" }),
        Err(_) => json!({ "ok": false, "error": "CLI session bridge request is invalid" }),
    };
    let encoded = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    reader
        .get_mut()
        .write_all(format!("{encoded}\n").as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    reader
        .get_mut()
        .flush()
        .await
        .map_err(|error| error.to_string())
}

#[async_trait]
impl HiveoryExternalToolProvider for HiveoryExternalTools {
    async fn definitions(&self, agent_id: &str) -> Result<Vec<AgentToolDefinition>, String> {
        let mut definitions = self.plugin.definitions(agent_id).await?;
        definitions.extend(self.browser.definitions().await);
        definitions.extend(self.computer.definitions().await);
        Ok(definitions)
    }

    async fn execute(
        &self,
        run_id: &str,
        agent_id: &str,
        name: &str,
        arguments_json: &str,
    ) -> Result<String, String> {
        if name.starts_with("browser.") {
            self.browser.execute(name, arguments_json).await
        } else if name.starts_with("computer.") {
            self.computer.execute(name, arguments_json).await
        } else if name.starts_with("plugin.") {
            self.plugin
                .execute(run_id, agent_id, name, arguments_json)
                .await
        } else {
            Err("external tool is not available".to_owned())
        }
    }
}

fn is_code_workspace_section(value: &str) -> bool {
    matches!(
        value,
        "dashboard" | "routines" | "plugins" | "skills" | "workspace"
    )
}

#[derive(Clone)]
struct HiveoryFoundation {
    database_path: PathBuf,
    persistence: HiveoryPersistence,
    secrets: HiveorySecretStoreHandle,
    provider: Arc<dyn HiveoryModelProvider>,
    jobs: HiveoryJobRuntime,
    notifications: HiveoryNotificationService,
    audit: HiveoryAuditLog,
    chat: HiveoryChatStore,
    artifacts: HiveoryArtifactStore,
    agent_runtime: HiveoryAgentRuntime,
    plugin_runtime: HiveoryPluginRuntime,
    routine_scheduler: HiveoryRoutineScheduler,
    chat_events: broadcast::Sender<ChatEventEnvelope>,
    chat_cancellations: Arc<std::sync::Mutex<HashMap<String, CancellationToken>>>,
    recovery_message: Arc<RwLock<Option<String>>>,
    code_workspaces: HiveoryWorkspaceService,
    code_workspaces_root: PathBuf,
    code_runtime: HiveoryCodeRuntime,
    terminal_host: HiveoryTerminalHostClient,
    code_git: HiveoryGitService,
    code_orchestration: HiveoryCodeOrchestration,
    code_active_workspace_id: Arc<RwLock<Option<String>>>,
    code_active_section: Arc<RwLock<String>>,
    code_terminal_launches: Arc<std::sync::Mutex<HashSet<String>>>,
}

struct CodeTerminalLaunchReservation {
    launches: Arc<std::sync::Mutex<HashSet<String>>>,
    key: String,
}

fn forward_terminal_events(
    host: HiveoryTerminalHostClient,
    terminal_id: String,
    after_sequence: u64,
    channel: Channel<CodeTerminalEvent>,
) {
    tauri::async_runtime::spawn(async move {
        let Ok(mut receiver) = host
            .subscribe(&CodeTerminalSubscribeRequest {
                terminal_id,
                after_sequence,
            })
            .await
        else {
            return;
        };
        while let Ok(event) = receiver.recv().await {
            if channel.send(event).is_err() {
                break;
            }
        }
    });
}

impl Drop for CodeTerminalLaunchReservation {
    fn drop(&mut self) {
        if let Ok(mut launches) = self.launches.lock() {
            launches.remove(&self.key);
        }
    }
}

impl HiveoryFoundation {
    async fn open(
        database_path: PathBuf,
        artifact_root: PathBuf,
        orchestration_root: PathBuf,
    ) -> Result<Self, String> {
        let persistence = HiveoryPersistence::open(&database_path)
            .await
            .map_err(|error| error.to_string())?;
        let secrets: HiveorySecretStoreHandle = Arc::new(HiveoryKeyringSecretStore);
        let history_key_ref = ensure_terminal_history_key(&persistence, &secrets).await?;
        let terminal_host =
            HiveoryTerminalHostClient::connect_or_start(database_path.clone(), history_key_ref)
                .await
                .map_err(|error| error.to_string())?;
        let previous_shutdown_was_clean = persistence
            .previous_shutdown_was_clean()
            .await
            .map_err(|error| error.to_string())?;
        let code_workspaces_root = orchestration_root
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("code-workspaces");
        let code_workspaces = HiveoryWorkspaceService::new();
        let persisted_workspaces = persistence
            .code_workspaces()
            .await
            .map_err(|error| error.to_string())?;
        let persisted_context = persistence
            .get_setting(CODE_WORKSPACE_CONTEXT_SETTING)
            .await
            .map_err(|error| error.to_string())?
            .and_then(|value| serde_json::from_str::<CodeWorkspaceContext>(&value).ok())
            .unwrap_or_default();
        for summary in &persisted_workspaces {
            if code_workspaces
                .open_workspace(
                    Path::new(&summary.root_path),
                    Some(&summary.id),
                    summary.trust,
                )
                .is_ok()
            {
                let _ = code_workspaces.update_workspace_metadata(
                    &summary.id,
                    HiveoryWorkspaceMetadata {
                        project_id: summary.project_id.clone(),
                        workspace_kind: summary.workspace_kind,
                        worktree_name: summary.worktree_name.clone(),
                        base_ref: summary.base_ref.clone(),
                        parent_workspace_id: summary.parent_workspace_id.clone(),
                        branch: summary.branch.clone(),
                        managed_by_app: summary.managed_by_app,
                        available: summary.available,
                        unavailable_reason: summary.unavailable_reason.clone(),
                    },
                );
            }
        }
        let restored_workspace_id = persisted_context
            .workspace_id
            .clone()
            .filter(|workspace_id| {
                persisted_workspaces
                    .iter()
                    .any(|summary| &summary.id == workspace_id)
            })
            .or_else(|| {
                persisted_workspaces
                    .first()
                    .map(|summary| summary.id.clone())
            });
        let code_active_workspace_id = Arc::new(RwLock::new(restored_workspace_id));
        let code_active_section = Arc::new(RwLock::new(
            if is_code_workspace_section(&persisted_context.section) {
                persisted_context.section
            } else {
                "workspace".to_owned()
            },
        ));
        let code_orchestration = HiveoryCodeOrchestration::new(
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
        let chat = HiveoryChatStore::new(persistence.clone());
        let interrupted_chats = chat
            .interrupt_active_turns()
            .await
            .map_err(|error| error.to_string())?;
        let jobs = HiveoryJobRuntime::new(persistence.clone());
        let provider: Arc<dyn HiveoryModelProvider> =
            Arc::new(HiveoryOpenAiResponsesProvider::new(secrets.clone()));
        let notifications = HiveoryNotificationService::new(persistence.clone(), jobs.clone());
        let audit = HiveoryAuditLog::new(persistence.clone());
        let plugin_runtime =
            HiveoryPluginRuntime::new(persistence.clone(), secrets.clone(), audit.clone())
                .map_err(|error| error.to_string())?;
        plugin_runtime
            .initialize()
            .await
            .map_err(|error| error.to_string())?;
        let artifacts = HiveoryArtifactStore::new(artifact_root.clone());
        let agent_runtime = HiveoryAgentRuntime::new(
            hiveory_persistence::agent::HiveoryAgentStore::new(persistence.clone()),
            provider.clone(),
            artifacts.clone(),
            audit.clone(),
            artifact_root.join("skills"),
        );
        agent_runtime.set_external_tool_provider(Arc::new(plugin_runtime.clone()));
        let routine_scheduler = HiveoryRoutineScheduler::new(
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
            database_path,
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
            code_workspaces_root,
            code_runtime: HiveoryCodeRuntime::new(),
            terminal_host,
            code_git: HiveoryGitService,
            code_orchestration,
            code_active_workspace_id,
            code_active_section,
            code_terminal_launches: Arc::new(std::sync::Mutex::new(HashSet::new())),
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

    async fn reopen_persisted_code_workspace(
        &self,
        persisted: &CodeWorkspaceSummary,
    ) -> Result<CodeWorkspaceSummary, ApiError> {
        let opened = self
            .code_workspaces
            .open_workspace(
                Path::new(&persisted.root_path),
                Some(&persisted.id),
                persisted.trust,
            )
            .map_err(workspace_error)?;
        if opened.id != persisted.id {
            return Err(application_error(
                "workspace_identity_conflict",
                "The saved workspace path is already attached to a different workspace.",
                RetryClass::AfterUserAction,
            ));
        }
        let summary = self
            .code_workspaces
            .update_workspace_metadata(
                &persisted.id,
                HiveoryWorkspaceMetadata {
                    project_id: persisted.project_id.clone(),
                    workspace_kind: persisted.workspace_kind,
                    worktree_name: persisted.worktree_name.clone(),
                    base_ref: persisted.base_ref.clone(),
                    parent_workspace_id: persisted.parent_workspace_id.clone(),
                    branch: persisted.branch.clone(),
                    managed_by_app: persisted.managed_by_app,
                    available: true,
                    unavailable_reason: None,
                },
            )
            .map_err(workspace_error)?;
        self.persistence
            .save_code_workspace(&summary)
            .await
            .map_err(database_error)?;
        Ok(summary)
    }

    async fn code_snapshot(&self) -> Result<CodeSnapshot, ApiError> {
        let persisted_workspaces = self
            .persistence
            .code_workspaces()
            .await
            .map_err(database_error)?;
        let mut workspaces = self.code_workspaces.summaries().map_err(workspace_error)?;
        for persisted in persisted_workspaces {
            let loaded_index = workspaces
                .iter()
                .position(|workspace| workspace.id == persisted.id);
            if loaded_index
                .and_then(|index| workspaces.get(index))
                .is_some_and(|workspace| {
                    workspace.available
                        && std::fs::metadata(&persisted.root_path)
                            .map(|metadata| metadata.is_dir())
                            .unwrap_or(false)
                })
            {
                continue;
            }
            match self.reopen_persisted_code_workspace(&persisted).await {
                Ok(summary) => {
                    if let Some(index) = loaded_index {
                        workspaces[index] = summary;
                    } else {
                        workspaces.push(summary);
                    }
                }
                Err(error) => {
                    let mut unavailable = persisted;
                    unavailable.available = false;
                    unavailable.unavailable_reason = Some(error.message);
                    if let Some(index) = loaded_index {
                        workspaces[index] = unavailable;
                    } else {
                        workspaces.push(unavailable);
                    }
                }
            }
        }
        workspaces.sort_by(|left, right| left.display_name.cmp(&right.display_name));

        let mut projects = self
            .persistence
            .code_projects()
            .await
            .map_err(database_error)?;
        for project in &projects {
            if let Some(workspace) = workspaces
                .iter_mut()
                .find(|workspace| workspace.id == project.primary_workspace_id)
            {
                // The primary workspace is the authoritative project relationship.
                // Older records could retain a legacy project id after migration.
                workspace.project_id = project.id.clone();
            }
        }
        for project in &mut projects {
            if workspaces
                .iter()
                .any(|workspace| workspace.project_id == project.id && workspace.available)
            {
                project.available = true;
                project.unavailable_reason = None;
            } else {
                project.available = false;
                project.unavailable_reason = Some(
                    "No workspace folder for this project is available on this device.".to_owned(),
                );
            }
        }
        let active_workspace_id = {
            let current = self
                .code_active_workspace_id
                .read()
                .map_err(|_| unavailable_error())?
                .clone();
            current.filter(|workspace_id| {
                workspaces
                    .iter()
                    .any(|workspace| workspace.id == *workspace_id && workspace.available)
            })
        };
        let active_workspace_id = active_workspace_id.or_else(|| {
            workspaces
                .iter()
                .find(|workspace| workspace.available)
                .map(|workspace| workspace.id.clone())
        });
        let context_changed = {
            let mut active = self
                .code_active_workspace_id
                .write()
                .map_err(|_| unavailable_error())?;
            if *active == active_workspace_id {
                false
            } else {
                *active = active_workspace_id.clone();
                true
            }
        };
        if context_changed {
            self.persist_code_workspace_context().await?;
        }
        Ok(CodeSnapshot {
            projects,
            workspaces,
            active_workspace_id,
            adapters: self.code_runtime.adapters(),
        })
    }

    async fn code_workspace_context(&self) -> Result<CodeWorkspaceContext, ApiError> {
        Ok(CodeWorkspaceContext {
            workspace_id: self
                .code_active_workspace_id
                .read()
                .map_err(|_| unavailable_error())?
                .clone(),
            section: self
                .code_active_section
                .read()
                .map_err(|_| unavailable_error())?
                .clone(),
        })
    }

    async fn persist_code_workspace_context(&self) -> Result<(), ApiError> {
        let context = self.code_workspace_context().await?;
        let value = serde_json::to_string(&context).map_err(|error| {
            application_error(
                "code_workspace_context_serialize",
                error.to_string(),
                RetryClass::AfterUserAction,
            )
        })?;
        self.persistence
            .set_setting(CODE_WORKSPACE_CONTEXT_SETTING, &value)
            .await
            .map_err(database_error)
    }

    async fn set_code_workspace_context(
        &self,
        update: CodeWorkspaceContextUpdate,
    ) -> Result<CodeWorkspaceContext, ApiError> {
        if !is_code_workspace_section(&update.section) {
            return Err(validation_error("The selected Code section is invalid."));
        }
        if let Some(workspace_id) = update.workspace_id.as_deref() {
            let workspace = self
                .code_workspaces
                .summary(workspace_id)
                .map_err(workspace_error)?;
            if !workspace.available {
                return Err(validation_error("The selected workspace is not available."));
            }
        }
        *self
            .code_active_workspace_id
            .write()
            .map_err(|_| unavailable_error())? = update.workspace_id;
        *self
            .code_active_section
            .write()
            .map_err(|_| unavailable_error())? = update.section;
        self.persist_code_workspace_context().await?;
        self.code_workspace_context().await
    }

    async fn add_code_project(&self, path: &str) -> Result<CodeWorkspaceDetail, ApiError> {
        let canonical_root = std::fs::canonicalize(path.trim()).map_err(|error| {
            validation_error(format!(
                "The selected project folder could not be opened: {error}"
            ))
        })?;
        if !canonical_root.is_dir() {
            return Err(validation_error(
                "The selected project path must be a directory.",
            ));
        }
        let canonical_root_string = canonical_root.to_string_lossy().into_owned();
        if let Some(project) = self
            .persistence
            .code_project_by_root("local", &canonical_root_string)
            .await
            .map_err(database_error)?
        {
            *self
                .code_active_workspace_id
                .write()
                .map_err(|_| unavailable_error())? = Some(project.primary_workspace_id.clone());
            return self.code_detail(&project.primary_workspace_id).await;
        }

        let is_git_repository = canonical_root.join(".git").exists();
        let branch = if is_git_repository {
            self.code_git
                .current_branch(&canonical_root)
                .map_err(git_error)?
        } else {
            None
        };
        let workspace_id = uuid::Uuid::now_v7().to_string();
        let project_id = format!("project-{}", uuid::Uuid::now_v7());
        let opened = self
            .code_workspaces
            .open_workspace(
                &canonical_root,
                Some(&workspace_id),
                CodeWorkspaceTrust::Untrusted,
            )
            .map_err(workspace_error)?;
        let summary = self
            .code_workspaces
            .update_workspace_metadata(
                &opened.id,
                HiveoryWorkspaceMetadata {
                    project_id: project_id.clone(),
                    workspace_kind: hiveory_protocol::CodeWorkspaceKind::Primary,
                    worktree_name: None,
                    base_ref: None,
                    parent_workspace_id: None,
                    branch: branch.clone(),
                    managed_by_app: false,
                    available: true,
                    unavailable_reason: None,
                },
            )
            .map_err(workspace_error)?;
        let now = now_ms();
        let project = CodeProjectSummary {
            id: project_id,
            host_id: "local".to_owned(),
            display_name: summary.display_name.clone(),
            root_path: summary.root_path.clone(),
            repository_name: summary.repository_name.clone(),
            kind: if is_git_repository {
                CodeProjectKind::Git
            } else {
                CodeProjectKind::Folder
            },
            primary_workspace_id: summary.id.clone(),
            current_branch: branch,
            workspace_count: 1,
            available: true,
            unavailable_reason: None,
            updated_at_unix_ms: now,
        };
        self.persistence
            .save_code_project(&project)
            .await
            .map_err(database_error)?;
        self.persistence
            .save_code_workspace(&summary)
            .await
            .map_err(database_error)?;
        self.persistence
            .save_code_layout(&default_layout(&summary.id))
            .await
            .map_err(database_error)?;
        *self
            .code_active_workspace_id
            .write()
            .map_err(|_| unavailable_error())? = Some(summary.id.clone());
        self.audit
            .record(
                "code.project.add",
                "success",
                "info",
                Some(&project.id),
                Some("project registered with an untrusted primary workspace"),
            )
            .await
            .map_err(database_error)?;
        self.code_detail(&summary.id).await
    }

    async fn create_code_workspace(
        &self,
        request: &CodeWorkspaceCreateRequest,
    ) -> Result<CodeWorkspaceDetail, ApiError> {
        let project = self
            .persistence
            .code_project(&request.project_id)
            .await
            .map_err(database_error)?
            .ok_or_else(|| validation_error("The selected project no longer exists."))?;
        let display_name = validate_workspace_display_name(&request.name)?;
        let project_root = PathBuf::from(&project.root_path);
        let base_ref = request
            .base_ref
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("HEAD")
            .to_owned();
        let base_oid = if !matches!(project.kind, CodeProjectKind::Git) {
            let oid = self
                .code_git
                .ensure_repository(&project_root)
                .map_err(git_error)?;
            let mut updated_project = project.clone();
            updated_project.kind = CodeProjectKind::Git;
            self.persistence
                .save_code_project(&updated_project)
                .await
                .map_err(database_error)?;
            oid
        } else {
            self.code_git
                .resolve_ref_oid(&project_root, &base_ref)
                .map_err(git_error)?
        };
        let branch_name = request
            .branch_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("workspace/{}", workspace_slug(&display_name)));
        validate_branch_name(&branch_name)?;

        let workspace_id = uuid::Uuid::now_v7().to_string();
        let worktree_name = format!(
            "{}-{}",
            workspace_slug(&display_name),
            workspace_id.chars().take(8).collect::<String>()
        );
        let managed_path = self
            .code_workspaces_root
            .join(&project.id)
            .join(&worktree_name);
        let created = self
            .code_git
            .create_worktree(
                &project_root,
                &worktree_name,
                &managed_path,
                &branch_name,
                &base_oid,
            )
            .map_err(git_error)?;
        let opened = match self.code_workspaces.open_workspace(
            &created.path,
            Some(&workspace_id),
            CodeWorkspaceTrust::Untrusted,
        ) {
            Ok(summary) => summary,
            Err(error) => {
                let _ = self.code_git.remove_worktree(
                    &project_root,
                    &created.name,
                    &created.path,
                    &self.code_workspaces_root,
                    true,
                );
                return Err(workspace_error(error));
            }
        };
        let summary = self
            .code_workspaces
            .update_workspace_metadata(
                &opened.id,
                HiveoryWorkspaceMetadata {
                    project_id: project.id.clone(),
                    workspace_kind: hiveory_protocol::CodeWorkspaceKind::ManagedWorktree,
                    worktree_name: Some(created.name),
                    base_ref: Some(base_ref),
                    parent_workspace_id: None,
                    branch: Some(created.branch),
                    managed_by_app: true,
                    available: true,
                    unavailable_reason: None,
                },
            )
            .map_err(workspace_error)?;
        let summary = self
            .code_workspaces
            .rename_workspace(&summary.id, display_name)
            .map_err(workspace_error)?;
        self.persistence
            .save_code_workspace(&summary)
            .await
            .map_err(database_error)?;
        self.persistence
            .save_code_layout(&default_layout(&summary.id))
            .await
            .map_err(database_error)?;
        *self
            .code_active_workspace_id
            .write()
            .map_err(|_| unavailable_error())? = Some(summary.id.clone());
        self.audit
            .record(
                "code.workspace.create",
                "success",
                "info",
                Some(&summary.id),
                Some("managed Git workspace created from the selected project"),
            )
            .await
            .map_err(database_error)?;
        self.code_detail(&summary.id).await
    }

    async fn update_code_workspace(
        &self,
        request: &CodeWorkspaceUpdateRequest,
    ) -> Result<CodeWorkspaceDetail, ApiError> {
        let workspace_id = request.workspace_id.trim();
        if workspace_id.is_empty() {
            return Err(validation_error("A workspace is required."));
        }
        let display_name = validate_workspace_display_name(&request.display_name)?;
        let current = self
            .persistence
            .code_workspace(workspace_id)
            .await
            .map_err(database_error)?
            .ok_or_else(|| validation_error("The selected workspace no longer exists."))?;
        let summary = self
            .code_workspaces
            .rename_workspace(workspace_id, display_name)
            .map_err(workspace_error)?;
        self.persistence
            .save_code_workspace(&summary)
            .await
            .map_err(database_error)?;

        if matches!(
            current.workspace_kind,
            hiveory_protocol::CodeWorkspaceKind::Primary
        ) {
            if let Some(mut project) = self
                .persistence
                .code_project(&current.project_id)
                .await
                .map_err(database_error)?
            {
                project.display_name = summary.display_name.clone();
                project.updated_at_unix_ms = summary.updated_at_unix_ms;
                self.persistence
                    .save_code_project(&project)
                    .await
                    .map_err(database_error)?;
            }
        }
        self.audit
            .record(
                "code.workspace.update",
                "success",
                "info",
                Some(&summary.id),
                Some("workspace display name updated"),
            )
            .await
            .map_err(database_error)?;
        self.code_detail(&summary.id).await
    }

    async fn set_code_workspace_parent(
        &self,
        request: &CodeWorkspaceParentRequest,
    ) -> Result<CodeWorkspaceDetail, ApiError> {
        let workspace_id = request.workspace_id.trim();
        if workspace_id.is_empty() {
            return Err(validation_error("A workspace is required."));
        }
        let child = self
            .persistence
            .code_workspace(workspace_id)
            .await
            .map_err(database_error)?
            .ok_or_else(|| validation_error("The selected workspace no longer exists."))?;
        let parent_workspace_id = request
            .parent_workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        if matches!(
            child.workspace_kind,
            hiveory_protocol::CodeWorkspaceKind::Primary
        ) && parent_workspace_id.is_some()
        {
            return Err(validation_error(
                "The primary workspace is the root and cannot have a parent.",
            ));
        }
        if let Some(parent_id) = parent_workspace_id.as_deref() {
            let parent = self
                .persistence
                .code_workspace(parent_id)
                .await
                .map_err(database_error)?
                .ok_or_else(|| {
                    validation_error("The selected parent workspace no longer exists.")
                })?;
            if !parent.available {
                return Err(validation_error(
                    "The selected parent workspace is unavailable.",
                ));
            }
            if parent.project_id != child.project_id {
                return Err(validation_error(
                    "Parent and child workspaces must belong to the same project.",
                ));
            }
        }
        let summary = self
            .code_workspaces
            .set_parent_workspace(workspace_id, parent_workspace_id)
            .map_err(workspace_error)?;
        self.persistence
            .save_code_workspace(&summary)
            .await
            .map_err(database_error)?;
        self.audit
            .record(
                "code.workspace.parent.update",
                "success",
                "info",
                Some(&summary.id),
                Some(if summary.parent_workspace_id.is_some() {
                    "workspace parent relationship updated"
                } else {
                    "workspace parent relationship cleared"
                }),
            )
            .await
            .map_err(database_error)?;
        self.code_detail(&summary.id).await
    }

    async fn open_code_workspace_in(
        &self,
        request: &CodeWorkspaceOpenInRequest,
    ) -> Result<bool, ApiError> {
        if request.target == CodeWorkspaceOpenTarget::Terminal {
            return Err(application_error(
                "external_terminal_disabled",
                "External terminals are disabled. Start a terminal from the embedded workspace pane.",
                RetryClass::AfterUserAction,
            ));
        }

        let workspace_id = request.workspace_id.trim();
        if workspace_id.is_empty() {
            return Err(validation_error("A workspace is required."));
        }
        let summary = self
            .persistence
            .code_workspace(workspace_id)
            .await
            .map_err(database_error)?
            .ok_or_else(|| validation_error("The selected workspace no longer exists."))?;
        let path = PathBuf::from(&summary.root_path);
        if !path.is_dir() {
            return Err(validation_error(
                "The workspace folder is unavailable on this device.",
            ));
        }

        #[cfg(target_os = "windows")]
        let spawn_result = match request.target {
            CodeWorkspaceOpenTarget::FileManager => Command::new("explorer.exe").arg(&path).spawn(),
            CodeWorkspaceOpenTarget::Terminal => {
                unreachable!("external terminals are rejected above")
            }
        };
        #[cfg(target_os = "macos")]
        let spawn_result = match request.target {
            CodeWorkspaceOpenTarget::FileManager => Command::new("open").arg(&path).spawn(),
            CodeWorkspaceOpenTarget::Terminal => {
                unreachable!("external terminals are rejected above")
            }
        };
        #[cfg(all(unix, not(target_os = "macos")))]
        let spawn_result = match request.target {
            CodeWorkspaceOpenTarget::FileManager => Command::new("xdg-open").arg(&path).spawn(),
            CodeWorkspaceOpenTarget::Terminal => {
                unreachable!("external terminals are rejected above")
            }
        };
        #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
        let spawn_result: Result<std::process::Child, std::io::Error> = Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "opening external workspace applications is not supported on this platform",
        ));

        spawn_result.map_err(|error| {
            application_error(
                "workspace_open_failed",
                format!("The workspace could not be opened externally: {error}"),
                RetryClass::AfterUserAction,
            )
        })?;
        self.audit
            .record(
                "code.workspace.open_in",
                "success",
                "info",
                Some(&summary.id),
                Some(match request.target {
                    CodeWorkspaceOpenTarget::FileManager => "workspace opened in the file manager",
                    CodeWorkspaceOpenTarget::Terminal => "workspace opened in an external terminal",
                }),
            )
            .await
            .map_err(database_error)?;
        Ok(true)
    }

    async fn stop_code_workspace_terminals(&self, workspace_id: &str) -> Result<(), ApiError> {
        let terminals = self
            .terminal_host
            .list()
            .await
            .map_err(terminal_host_error)?
            .into_iter()
            .filter(|terminal| terminal.workspace_id == workspace_id)
            .collect::<Vec<_>>();
        for terminal in terminals {
            if self
                .terminal_host
                .stop_and_wait(
                    &CodeTerminalStopRequest {
                        terminal_id: terminal.id.clone(),
                        force: true,
                    },
                    terminal.pid,
                )
                .await
                .map_err(terminal_host_error)?
            {
                // Destructive stops wait for both the host reader and the
                // native process so Git never races a live PTY.
            }
        }
        Ok(())
    }

    async fn release_code_workspace_handles(
        &self,
        workspaces: &[CodeWorkspaceSummary],
    ) -> Result<(), ApiError> {
        for workspace in workspaces {
            match self.code_workspaces.close_workspace(&workspace.id) {
                Ok(_) | Err(HiveoryWorkspaceError::NotFound) => {}
                Err(error) => return Err(workspace_error(error)),
            }
        }
        Ok(())
    }

    async fn restore_code_workspace_handles(&self, workspaces: &[CodeWorkspaceSummary]) {
        for workspace in workspaces {
            if !Path::new(&workspace.root_path).is_dir()
                || self.code_workspaces.summary(&workspace.id).is_ok()
            {
                continue;
            }
            let _ = self.reopen_persisted_code_workspace(workspace).await;
        }
    }

    async fn remove_code_workspace(
        &self,
        request: &CodeWorkspaceRemoveRequest,
    ) -> Result<CodeSnapshot, ApiError> {
        let workspace_id = request.workspace_id.trim();
        if workspace_id.is_empty() {
            return Err(validation_error("A workspace is required."));
        }
        let summary = match self
            .persistence
            .code_workspace(workspace_id)
            .await
            .map_err(database_error)?
        {
            Some(summary) => summary,
            None => self
                .code_workspaces
                .summary(workspace_id)
                .map_err(workspace_error)?,
        };
        let project = self
            .persistence
            .code_project(&summary.project_id)
            .await
            .map_err(database_error)?
            .ok_or_else(|| validation_error("The workspace project no longer exists."))?;
        if matches!(
            summary.workspace_kind,
            hiveory_protocol::CodeWorkspaceKind::Primary
        ) || summary.id == project.primary_workspace_id
        {
            return Err(validation_error(
                "The primary workspace cannot be deleted. Remove the project instead.",
            ));
        }

        let worktree_name = if summary.managed_by_app {
            Some(summary.worktree_name.as_deref().ok_or_else(|| {
                validation_error("The managed workspace has no Git worktree identity.")
            })?)
        } else {
            None
        };
        self.stop_code_workspace_terminals(&summary.id).await?;
        let mut project_workspaces = self
            .persistence
            .code_workspaces()
            .await
            .map_err(database_error)?
            .into_iter()
            .filter(|workspace| {
                workspace.project_id == project.id || workspace.id == project.primary_workspace_id
            })
            .collect::<Vec<_>>();
        if !project_workspaces
            .iter()
            .any(|workspace| workspace.id == summary.id)
        {
            project_workspaces.push(summary.clone());
        }
        if let Err(error) = self
            .release_code_workspace_handles(&project_workspaces)
            .await
        {
            self.restore_code_workspace_handles(&project_workspaces)
                .await;
            return Err(error);
        }
        if let Some(worktree_name) = worktree_name {
            let removal = self
                .code_git
                .remove_worktree(
                    Path::new(&project.root_path),
                    worktree_name,
                    Path::new(&summary.root_path),
                    &self.code_workspaces_root,
                    request.force,
                )
                .map_err(git_error);
            if let Err(error) = removal {
                self.restore_code_workspace_handles(&project_workspaces)
                    .await;
                return Err(error);
            }
        }

        let surviving_workspaces = project_workspaces
            .iter()
            .filter(|workspace| workspace.id != summary.id)
            .cloned()
            .collect::<Vec<_>>();
        self.restore_code_workspace_handles(&surviving_workspaces)
            .await;

        // Removing a parent must not leave dangling hierarchy metadata in the
        // in-memory service. SQLite also clears the foreign key on delete, but
        // the service needs the same update before the next snapshot.
        let children = self
            .persistence
            .code_workspaces()
            .await
            .map_err(database_error)?
            .into_iter()
            .filter(|workspace| {
                workspace.parent_workspace_id.as_deref() == Some(summary.id.as_str())
            })
            .collect::<Vec<_>>();
        for child in children {
            if let Ok(updated) = self.code_workspaces.set_parent_workspace(&child.id, None) {
                self.persistence
                    .save_code_workspace(&updated)
                    .await
                    .map_err(database_error)?;
            }
        }

        self.persistence
            .delete_code_workspace(&summary.id)
            .await
            .map_err(database_error)?;
        let should_move_active = self
            .code_active_workspace_id
            .read()
            .map_err(|_| unavailable_error())?
            .as_deref()
            == Some(summary.id.as_str());
        if should_move_active {
            *self
                .code_active_workspace_id
                .write()
                .map_err(|_| unavailable_error())? = Some(project.primary_workspace_id.clone());
            self.persist_code_workspace_context().await?;
        }
        self.audit
            .record(
                "code.workspace.remove",
                "success",
                "warning",
                Some(&summary.id),
                Some(if summary.managed_by_app {
                    "secondary managed workspace and its app-owned worktree removed"
                } else {
                    "secondary workspace detached without deleting user files"
                }),
            )
            .await
            .map_err(database_error)?;
        self.code_snapshot().await
    }

    async fn remove_code_project(
        &self,
        request: &CodeProjectRemoveRequest,
    ) -> Result<CodeSnapshot, ApiError> {
        let project_id = request.project_id.trim();
        if project_id.is_empty() {
            return Err(validation_error("A project is required."));
        }
        let project = self
            .persistence
            .code_project(project_id)
            .await
            .map_err(database_error)?
            .ok_or_else(|| validation_error("The selected project no longer exists."))?;
        let workspaces = self
            .persistence
            .code_workspaces()
            .await
            .map_err(database_error)?
            .into_iter()
            .filter(|workspace| {
                workspace.project_id == project.id || workspace.id == project.primary_workspace_id
            })
            .collect::<Vec<_>>();

        for workspace in &workspaces {
            if workspace.managed_by_app
                && workspace.id != project.primary_workspace_id
                && workspace.worktree_name.is_none()
            {
                return Err(validation_error(
                    "A managed workspace has no Git worktree identity.",
                ));
            }
        }
        for workspace in &workspaces {
            self.stop_code_workspace_terminals(&workspace.id).await?;
        }
        if let Err(error) = self.release_code_workspace_handles(&workspaces).await {
            self.restore_code_workspace_handles(&workspaces).await;
            return Err(error);
        }
        for workspace in &workspaces {
            if !workspace.managed_by_app || workspace.id == project.primary_workspace_id {
                continue;
            }
            let Some(worktree_name) = workspace.worktree_name.as_deref() else {
                self.restore_code_workspace_handles(&workspaces).await;
                return Err(validation_error(
                    "A managed workspace has no Git worktree identity.",
                ));
            };
            let removal = self
                .code_git
                .remove_worktree(
                    Path::new(&project.root_path),
                    worktree_name,
                    Path::new(&workspace.root_path),
                    &self.code_workspaces_root,
                    request.force,
                )
                .map_err(git_error);
            if let Err(error) = removal {
                self.restore_code_workspace_handles(&workspaces).await;
                return Err(error);
            }
            // Commit each completed worktree stage so a later failure leaves
            // the project and only the remaining workspace records intact.
            self.persistence
                .delete_code_workspace(&workspace.id)
                .await
                .map_err(database_error)?;
        }

        for workspace in &workspaces {
            if workspace.managed_by_app && workspace.id != project.primary_workspace_id {
                continue;
            }
            self.persistence
                .delete_code_workspace(&workspace.id)
                .await
                .map_err(database_error)?;
        }
        self.persistence
            .delete_code_project(&project.id)
            .await
            .map_err(database_error)?;
        *self
            .code_active_workspace_id
            .write()
            .map_err(|_| unavailable_error())? = None;
        self.audit
            .record(
                "code.project.remove",
                "success",
                "warning",
                Some(&project.id),
                Some("project metadata removed; the primary project folder was preserved"),
            )
            .await
            .map_err(database_error)?;
        self.code_snapshot().await
    }

    async fn code_detail(&self, workspace_id: &str) -> Result<CodeWorkspaceDetail, ApiError> {
        let summary = match self.code_workspaces.summary(workspace_id) {
            Ok(summary)
                if summary.available
                    && std::fs::metadata(&summary.root_path)
                        .map(|metadata| metadata.is_dir())
                        .unwrap_or(false) =>
            {
                summary
            }
            _ => {
                let persisted = self
                    .persistence
                    .code_workspace(workspace_id)
                    .await
                    .map_err(database_error)?
                    .ok_or_else(|| workspace_error(HiveoryWorkspaceError::NotFound))?;
                self.reopen_persisted_code_workspace(&persisted).await?
            }
        };
        *self
            .code_active_workspace_id
            .write()
            .map_err(|_| unavailable_error())? = Some(summary.id.clone());
        self.persist_code_workspace_context().await?;
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
            .terminal_host
            .list()
            .await
            .map_err(terminal_host_error)?
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
fn hiveory_query_bootstrap(
    state: State<'_, HiveoryShellState>,
) -> Result<BootstrapSnapshot, ApiError> {
    let active_mode = *state.active_mode.read().map_err(|_| unavailable_error())?;
    Ok(BootstrapSnapshot {
        protocol: current_protocol_version(),
        active_mode,
        product_name: "Hiveory".to_owned(),
    })
}
#[tauri::command]
async fn hiveory_command_set_active_mode(
    command: SetActiveModeCommand,
    state: State<'_, HiveoryShellState>,
    foundation: State<'_, HiveoryFoundation>,
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
        product_name: "Hiveory".to_owned(),
    })
}
#[tauri::command]
fn hiveory_query_build_information() -> BuildInformation {
    BuildInformation {
        product_name: "Hiveory".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        protocol: current_protocol_version(),
    }
}
#[tauri::command]
async fn hiveory_query_diagnostic_snapshot(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<DiagnosticSnapshot, ApiError> {
    foundation.diagnostic_snapshot().await
}

#[tauri::command]
async fn hiveory_query_update(
    app: tauri::AppHandle,
    state: State<'_, HiveoryUpdateState>,
) -> Result<UpdateSnapshot, ApiError> {
    let current_version = app.package_info().version.to_string();
    let updater = app.updater().map_err(updater_error)?;
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
async fn hiveory_command_install_update(
    state: State<'_, HiveoryUpdateState>,
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
async fn hiveory_command_create_backup(
    app: tauri::AppHandle,
    destination: String,
    foundation: State<'_, HiveoryFoundation>,
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
    let _ = app.emit("hiveory://backup-created", summary.clone());
    Ok(summary)
}

#[tauri::command]
async fn hiveory_command_prepare_restore(
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
async fn hiveory_query_agent_dashboard(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentDashboard, ApiError> {
    foundation
        .agent_runtime
        .dashboard()
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_query_agents(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<hiveory_protocol::AgentSummary>, ApiError> {
    foundation
        .agent_runtime
        .list_agents()
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_query_agent(
    request: AgentIdRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentDetail, ApiError> {
    foundation
        .agent_runtime
        .agent_detail(&request.agent_id)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_create_agent(
    request: AgentCreateRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentDetail, ApiError> {
    foundation
        .agent_runtime
        .create_agent(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_update_agent(
    request: AgentUpdateRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentDetail, ApiError> {
    foundation
        .agent_runtime
        .update_agent(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_archive_agent(
    request: AgentIdRequest,
    archived: bool,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<(), ApiError> {
    foundation
        .agent_runtime
        .archive_agent(&request.agent_id, archived)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_delete_agent(
    request: AgentIdRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<(), ApiError> {
    foundation
        .agent_runtime
        .delete_agent(&request.agent_id)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_add_agent_folder(
    request: AgentFolderGrantRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentFolderGrant, ApiError> {
    foundation
        .agent_runtime
        .add_folder(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_delete_agent_folder(
    request: AgentFolderGrantDeleteRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<(), ApiError> {
    foundation
        .agent_runtime
        .delete_folder(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_query_agent_skills(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentSkillCatalog, ApiError> {
    foundation
        .agent_runtime
        .skill_catalog()
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_import_agent_skill(
    request: AgentSkillImportRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentSkillSummary, ApiError> {
    let source_path = Path::new(request.source_path.trim());
    if !source_path.is_file() {
        return Err(validation_error("Select a readable SKILL.md file."));
    }
    let source = std::fs::read_to_string(source_path)
        .map_err(|error| validation_error(format!("Could not read skill file: {error}")))?;
    foundation
        .agent_runtime
        .install_skill_markdown(&source)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_create_agent_skill(
    request: AgentSkillCreateRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentSkillSummary, ApiError> {
    foundation
        .agent_runtime
        .install_skill_markdown(&request.source)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_toggle_agent_skill(
    request: AgentSkillToggleRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentDetail, ApiError> {
    foundation
        .agent_runtime
        .set_skill(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_resolve_agent_skill_conflict(
    request: AgentSkillConflictResolutionRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentDetail, ApiError> {
    foundation
        .agent_runtime
        .set_skill_conflict(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_query_agent_memory(
    query: AgentMemoryQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<AgentMemorySummary>, ApiError> {
    foundation
        .agent_runtime
        .memory(&query)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_remember_agent_memory(
    request: AgentMemoryMutationRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentMemorySummary, ApiError> {
    foundation
        .agent_runtime
        .remember(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_delete_agent_memory(
    request: AgentMemoryDeleteRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<(), ApiError> {
    foundation
        .agent_runtime
        .delete_memory(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_query_agent_conversations(
    query: AgentConversationQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<AgentConversationSummary>, ApiError> {
    foundation
        .agent_runtime
        .conversations(&query)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_query_agent_conversation(
    conversation_id: String,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentConversationDetail, ApiError> {
    foundation
        .agent_runtime
        .conversation(&conversation_id)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_create_agent_conversation(
    request: AgentConversationCreateRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentConversationDetail, ApiError> {
    foundation
        .agent_runtime
        .create_conversation(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_query_agent_runs(
    query: AgentRunsQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<AgentRunSummary>, ApiError> {
    foundation
        .agent_runtime
        .runs(&query)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_query_agent_run(
    run_id: String,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentRunDetail, ApiError> {
    foundation
        .agent_runtime
        .run_detail(&run_id)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_query_agent_events(
    query: AgentEventsQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<AgentEventEnvelope>, ApiError> {
    foundation
        .agent_runtime
        .events(&query)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_stream_agent_events(
    query: AgentEventsQuery,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_start_agent_run(
    request: AgentRunStartRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentRunSummary, ApiError> {
    foundation
        .agent_runtime
        .start_run(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_resume_agent_run(
    request: AgentRunControlRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentRunSummary, ApiError> {
    foundation
        .agent_runtime
        .resume_run(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_cancel_agent_run(
    request: AgentRunControlRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentRunSummary, ApiError> {
    foundation
        .agent_runtime
        .cancel_run(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_decide_agent_approval(
    request: AgentApprovalDecisionRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentRunSummary, ApiError> {
    foundation
        .agent_runtime
        .decide_approval(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_submit_agent_input(
    request: AgentInputRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentRunSummary, ApiError> {
    foundation
        .agent_runtime
        .submit_input(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_command_export_agent(
    request: AgentExportRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<(), ApiError> {
    foundation
        .agent_runtime
        .export_agent(&request)
        .await
        .map_err(agent_runtime_error)
}

#[tauri::command]
async fn hiveory_query_routines(
    query: RoutineQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<RoutineSummary>, ApiError> {
    foundation
        .routine_scheduler
        .list(&query)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn hiveory_query_routine(
    request: RoutineIdRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<RoutineDetail, ApiError> {
    foundation
        .routine_scheduler
        .detail(&request.routine_id)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn hiveory_command_create_routine(
    request: RoutineCreateRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<RoutineDetail, ApiError> {
    foundation
        .routine_scheduler
        .create(&request)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn hiveory_command_update_routine(
    request: RoutineUpdateRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<RoutineDetail, ApiError> {
    foundation
        .routine_scheduler
        .update(&request)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn hiveory_command_archive_routine(
    request: RoutineIdRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<(), ApiError> {
    foundation
        .routine_scheduler
        .archive(&request)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn hiveory_command_run_routine_now(
    request: RoutineIdRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<RoutineExecution, ApiError> {
    foundation
        .routine_scheduler
        .run_now(&request.routine_id)
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn hiveory_query_routine_executions(
    query: RoutineExecutionsQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<RoutineExecution>, ApiError> {
    foundation
        .routine_scheduler
        .executions(&query.routine_id, query.limit.unwrap_or(50))
        .await
        .map_err(routine_scheduler_error)
}

#[tauri::command]
async fn hiveory_query_plugin_catalog(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<PluginCatalogEntry>, ApiError> {
    foundation
        .plugin_runtime
        .catalog()
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_command_import_plugin_manifest(
    path: String,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<PluginCatalogEntry, ApiError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(validation_error("Choose a plugin manifest file."));
    }
    let metadata = std::fs::metadata(path)
        .map_err(|_| validation_error("The selected plugin manifest could not be read."))?;
    if !metadata.is_file() {
        return Err(validation_error(
            "The selected plugin manifest is not a file.",
        ));
    }
    if metadata.len() > 1024 * 1024 {
        return Err(validation_error(
            "Plugin manifests must be smaller than 1 MB.",
        ));
    }
    let contents = std::fs::read_to_string(path)
        .map_err(|_| validation_error("The selected plugin manifest must be UTF-8 JSON."))?;
    let manifest: PluginManifest = serde_json::from_str(&contents)
        .map_err(|error| validation_error(format!("Plugin manifest JSON is invalid: {error}")))?;
    foundation
        .plugin_runtime
        .import_manifest(manifest)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_command_register_plugin_manifest(
    manifest: PluginManifest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<PluginCatalogEntry, ApiError> {
    foundation
        .plugin_runtime
        .import_manifest(manifest)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_query_plugin_connections(
    plugin_id: Option<String>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<PluginConnectionSummary>, ApiError> {
    foundation
        .plugin_runtime
        .connections(plugin_id.as_deref())
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_command_install_plugin(
    request: PluginInstallRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<(), ApiError> {
    foundation
        .plugin_runtime
        .install(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_command_create_plugin_connection(
    request: PluginConnectionCreateRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<PluginConnectionSummary, ApiError> {
    foundation
        .plugin_runtime
        .create_connection(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_command_update_plugin_connection(
    request: PluginConnectionUpdateRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<PluginConnectionSummary, ApiError> {
    foundation
        .plugin_runtime
        .update_connection(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_command_delete_plugin_connection(
    request: PluginConnectionIdRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<(), ApiError> {
    foundation
        .plugin_runtime
        .delete_connection(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_command_test_plugin_connection(
    request: PluginConnectionIdRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<PluginConnectionSummary, ApiError> {
    foundation
        .plugin_runtime
        .test_connection(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_query_agent_plugin_grants(
    request: AgentIdRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<AgentPluginGrant>, ApiError> {
    foundation
        .plugin_runtime
        .agent_grants(&request.agent_id)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_command_set_agent_plugin_grant(
    request: AgentPluginGrantRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<AgentPluginGrant, ApiError> {
    foundation
        .plugin_runtime
        .set_agent_grant(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_command_dry_run_plugin(
    request: PluginDryRunRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<String, ApiError> {
    foundation
        .plugin_runtime
        .dry_run(&request)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_query_plugin_invocations(
    run_id: String,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<PluginInvocationSummary>, ApiError> {
    foundation
        .plugin_runtime
        .invocations_for_run(&run_id)
        .await
        .map_err(plugin_runtime_error)
}

#[tauri::command]
async fn hiveory_query_code_snapshot(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeSnapshot, ApiError> {
    foundation.code_snapshot().await
}

#[tauri::command]
async fn hiveory_query_code_workspace_context(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeWorkspaceContext, ApiError> {
    foundation.code_workspace_context().await
}

#[tauri::command]
async fn hiveory_command_set_code_workspace_context(
    command: CommandEnvelope<CodeWorkspaceContextUpdate>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeWorkspaceContext>, ApiError> {
    validate_code_command(&command)?;
    Ok(response(
        &command.request_id,
        foundation
            .set_code_workspace_context(command.payload)
            .await?,
    ))
}

#[tauri::command]
async fn hiveory_query_task_board_preferences(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<TaskBoardPreferences, ApiError> {
    let stored = foundation
        .persistence
        .get_setting(TASK_BOARD_PREFERENCES_SETTING)
        .await
        .map_err(database_error)?;
    Ok(stored
        .and_then(|value| serde_json::from_str::<TaskBoardPreferences>(&value).ok())
        .map(sanitize_task_board_preferences)
        .unwrap_or_default())
}

#[tauri::command]
async fn hiveory_command_update_task_board_preferences(
    request: TaskBoardPreferencesUpdate,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<TaskBoardPreferences, ApiError> {
    let preferences = sanitize_task_board_preferences(request.preferences);
    let value =
        serde_json::to_string(&preferences).map_err(|error| validation_error(error.to_string()))?;
    foundation
        .persistence
        .set_setting(TASK_BOARD_PREFERENCES_SETTING, &value)
        .await
        .map_err(database_error)?;
    Ok(preferences)
}

#[tauri::command]
async fn hiveory_query_code_workspace(
    query: CodeWorkspaceQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeWorkspaceDetail, ApiError> {
    let workspace_id = query
        .workspace_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| validation_error("A workspace is required."))?;
    foundation.code_detail(&workspace_id).await
}

#[tauri::command]
async fn hiveory_query_code_runs(
    workspace_id: Option<String>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<CodeRunSummary>, ApiError> {
    foundation
        .code_orchestration
        .runs(workspace_id.as_deref())
        .await
        .map_err(orchestration_error)
}

#[tauri::command]
async fn hiveory_query_code_run(
    run_id: String,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeRunDetail, ApiError> {
    foundation
        .code_orchestration
        .detail(&run_id)
        .await
        .map_err(orchestration_error)
}

#[tauri::command]
async fn hiveory_query_code_mailbox(
    query: CodeMailboxQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<CodeMailboxDelivery>, ApiError> {
    foundation
        .code_orchestration
        .mailbox(&query)
        .await
        .map_err(orchestration_error)
}

#[tauri::command]
async fn hiveory_command_send_code_mailbox(
    command: CommandEnvelope<CodeMailboxSendRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeMailboxDelivery>, ApiError> {
    validate_code_command(&command)?;
    let delivery = foundation
        .code_orchestration
        .send_mailbox_message(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, delivery))
}

#[tauri::command]
async fn hiveory_command_ack_code_mailbox(
    command: CommandEnvelope<CodeMailboxAckRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let acknowledged = foundation
        .code_orchestration
        .acknowledge_mailbox(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, acknowledged))
}

#[tauri::command]
async fn hiveory_query_code_gates(
    query: CodeGatesQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<CodeDecisionGate>, ApiError> {
    foundation
        .code_orchestration
        .gates(&query)
        .await
        .map_err(orchestration_error)
}

#[tauri::command]
async fn hiveory_command_create_code_gate(
    command: CommandEnvelope<CodeGateCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeDecisionGate>, ApiError> {
    validate_code_command(&command)?;
    let gate = foundation
        .code_orchestration
        .create_gate(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, gate))
}

#[tauri::command]
async fn hiveory_command_resolve_code_gate(
    command: CommandEnvelope<CodeGateResolveRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeDecisionGate>, ApiError> {
    validate_code_command(&command)?;
    let gate = foundation
        .code_orchestration
        .resolve_gate(&command.payload)
        .await
        .map_err(orchestration_error)?;
    Ok(response(&command.request_id, gate))
}

#[tauri::command]
async fn hiveory_query_code_orchestration_events(
    query: CodeOrchestrationEventsQuery,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_stream_code_orchestration_events(
    query: CodeOrchestrationEventsQuery,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_create_code_run(
    command: CommandEnvelope<CodeRunCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_update_code_run(
    command: CommandEnvelope<CodeRunUpdateRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_create_code_task(
    command: CommandEnvelope<CodeTaskCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_update_code_task(
    command: CommandEnvelope<CodeTaskUpdateRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_delete_code_task(
    command: CommandEnvelope<CodeTaskDeleteRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_propose_code_dag(
    command: CommandEnvelope<CodeDagProposalRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_accept_code_dag(
    command: CommandEnvelope<CodeDagProposalAcceptRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_start_code_run(
    command: CommandEnvelope<CodeRunRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_pause_code_run(
    command: CommandEnvelope<CodeRunRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_cancel_code_run(
    command: CommandEnvelope<CodeRunRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_resume_code_dispatch(
    command: CommandEnvelope<CodeDispatchResumeRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_cancel_code_dispatch(
    command: CommandEnvelope<CodeDispatchCancelRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_open_code_dispatch_terminal(
    command: CommandEnvelope<CodeDispatchTerminalRequest>,
    foundation: State<'_, HiveoryFoundation>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
    channel: Channel<CodeTerminalEvent>,
) -> Result<ResponseEnvelope<CodeTerminalSummary>, ApiError> {
    validate_code_command(&command)?;
    let context = foundation
        .code_orchestration
        .dispatch_terminal_context(&command.payload)
        .await
        .map_err(orchestration_error)?;
    let coding_agent = context.resume_session_id.is_some();
    let mut terminal_start = CodeTerminalStartRequest {
        workspace_id: context.workspace_id,
        kind: if coding_agent {
            hiveory_protocol::CodeTerminalKind::CodingAgent
        } else {
            hiveory_protocol::CodeTerminalKind::Shell
        },
        cols: command.payload.cols,
        rows: command.payload.rows,
        adapter_id: coding_agent.then_some(context.adapter_id),
        model: coding_agent.then_some(context.model).flatten(),
        agent_launch_mode: hiveory_protocol::CodeAgentLaunchMode::Standard,
        resume_session_id: coding_agent.then_some(context.resume_session_id).flatten(),
        session_integration: None,
    };
    if terminal_start.kind == hiveory_protocol::CodeTerminalKind::CodingAgent {
        terminal_start.session_integration = prepare_cli_session_integration(
            &foundation,
            app,
            (*browser).clone(),
            terminal_start.workspace_id.clone(),
            terminal_start.adapter_id.as_deref(),
            None,
        )
        .await?;
    }
    let summary = foundation
        .terminal_host
        .start(&terminal_start, &context.worktree_path, None, None)
        .await
        .map_err(terminal_host_error)?;
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
        let _ = foundation
            .terminal_host
            .stop(&CodeTerminalStopRequest {
                terminal_id: summary.id.clone(),
                force: true,
            })
            .await;
        return Err(validation_error(
            "The dispatch lease changed before the terminal could be attached.",
        ));
    }
    forward_terminal_events(
        foundation.terminal_host.clone(),
        summary.id.clone(),
        0,
        channel,
    );
    Ok(response(&command.request_id, summary))
}

#[tauri::command]
async fn hiveory_command_answer_code_question(
    command: CommandEnvelope<CodeQuestionAnswerRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_retry_code_task(
    command: CommandEnvelope<CodeTaskRetryRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_review_code_checkpoint(
    command: CommandEnvelope<CodeReviewRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_query_code_cleanup_preview(
    request: CodeCleanupPreviewRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeCleanupPreview, ApiError> {
    foundation
        .code_orchestration
        .cleanup_preview(&request)
        .await
        .map_err(orchestration_error)
}

#[tauri::command]
async fn hiveory_query_code_checkpoint_diff(
    request: CodeCheckpointDiffRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeGitDiff, ApiError> {
    foundation
        .code_orchestration
        .checkpoint_diff(&request)
        .await
        .map_err(orchestration_error)
}

#[tauri::command]
async fn hiveory_command_confirm_code_cleanup(
    command: CommandEnvelope<CodeCleanupConfirmRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
                    let _ = foundation
                        .terminal_host
                        .stop(&CodeTerminalStopRequest {
                            terminal_id: terminal_id.to_owned(),
                            force: true,
                        })
                        .await;
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
async fn hiveory_command_add_code_project(
    command: CommandEnvelope<CodeProjectAddRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeWorkspaceDetail>, ApiError> {
    validate_code_command(&command)?;
    let path = command.payload.path.trim();
    if path.is_empty() {
        return Err(validation_error("Choose a project folder first."));
    }
    Ok(response(
        &command.request_id,
        foundation.add_code_project(path).await?,
    ))
}

#[tauri::command]
async fn hiveory_command_open_code_workspace(
    command: CommandEnvelope<CodeWorkspaceOpenRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeWorkspaceDetail>, ApiError> {
    validate_code_command(&command)?;
    let path = command.payload.path.trim();
    if path.is_empty() {
        return Err(validation_error("Choose a workspace folder first."));
    }
    Ok(response(
        &command.request_id,
        foundation.add_code_project(path).await?,
    ))
}

#[tauri::command]
async fn hiveory_command_create_code_workspace(
    command: CommandEnvelope<CodeWorkspaceCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeWorkspaceDetail>, ApiError> {
    validate_code_command(&command)?;
    Ok(response(
        &command.request_id,
        foundation.create_code_workspace(&command.payload).await?,
    ))
}

#[tauri::command]
async fn hiveory_command_update_code_workspace(
    command: CommandEnvelope<CodeWorkspaceUpdateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeWorkspaceDetail>, ApiError> {
    validate_code_command(&command)?;
    Ok(response(
        &command.request_id,
        foundation.update_code_workspace(&command.payload).await?,
    ))
}

#[tauri::command]
async fn hiveory_command_set_code_workspace_parent(
    command: CommandEnvelope<CodeWorkspaceParentRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeWorkspaceDetail>, ApiError> {
    validate_code_command(&command)?;
    Ok(response(
        &command.request_id,
        foundation
            .set_code_workspace_parent(&command.payload)
            .await?,
    ))
}

#[tauri::command]
async fn hiveory_command_open_code_workspace_in(
    command: CommandEnvelope<CodeWorkspaceOpenInRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    Ok(response(
        &command.request_id,
        foundation.open_code_workspace_in(&command.payload).await?,
    ))
}

#[tauri::command]
async fn hiveory_command_remove_code_workspace(
    command: CommandEnvelope<CodeWorkspaceRemoveRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeSnapshot>, ApiError> {
    validate_code_command(&command)?;
    Ok(response(
        &command.request_id,
        foundation.remove_code_workspace(&command.payload).await?,
    ))
}

#[tauri::command]
async fn hiveory_command_remove_code_project(
    command: CommandEnvelope<CodeProjectRemoveRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeSnapshot>, ApiError> {
    validate_code_command(&command)?;
    Ok(response(
        &command.request_id,
        foundation.remove_code_project(&command.payload).await?,
    ))
}

#[tauri::command]
async fn hiveory_command_trust_code_workspace(
    command: CommandEnvelope<CodeWorkspaceTrustRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_query_code_file_tree(
    query: CodeFileTreeQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeFileTree, ApiError> {
    foundation
        .code_workspaces
        .file_tree(&query.workspace_id, query.relative_path.as_deref())
        .map_err(workspace_error)
}

#[tauri::command]
async fn hiveory_query_code_file(
    request: CodeReadFileRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeDocument, ApiError> {
    let document = foundation
        .code_workspaces
        .read_file(&request.workspace_id, &request.relative_path)
        .map_err(workspace_error)?;
    foundation
        .persistence
        .save_code_document(
            &request.workspace_id,
            &hiveory_protocol::CodeDocumentSummary {
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
async fn hiveory_command_save_code_file(
    command: CommandEnvelope<CodeSaveFileRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
            &hiveory_protocol::CodeDocumentSummary {
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
async fn hiveory_command_create_code_file(
    command: CommandEnvelope<CodeCreateFileRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeDocument>, ApiError> {
    validate_code_command(&command)?;
    if !is_markdown_path(&command.payload.relative_path) {
        return Err(validation_error(
            "New documents must use a .md or .markdown filename.",
        ));
    }
    let document = foundation
        .code_workspaces
        .create_file(
            &command.payload.workspace_id,
            &command.payload.relative_path,
            &command.payload.content,
        )
        .map_err(workspace_error)?;
    foundation
        .persistence
        .save_code_document(
            &command.payload.workspace_id,
            &hiveory_protocol::CodeDocumentSummary {
                relative_path: document.relative_path.clone(),
                language: document.language.clone(),
                last_fingerprint: Some(document.fingerprint.clone()),
                last_opened_at_unix_ms: now_ms(),
            },
        )
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, document))
}

#[tauri::command]
async fn hiveory_command_import_code_asset(
    command: CommandEnvelope<CodeImportAssetRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeImportedAsset>, ApiError> {
    validate_code_command(&command)?;
    let source = PathBuf::from(command.payload.source_path.trim());
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
    ) {
        return Err(validation_error(
            "Choose a PNG, JPEG, GIF, WebP, or SVG image.",
        ));
    }
    let bytes = std::fs::read(&source)
        .map_err(|error| workspace_error(HiveoryWorkspaceError::Io(error)))?;
    let original_stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let mut stem = original_stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    while stem.contains("--") {
        stem = stem.replace("--", "-");
    }
    let stem = stem.trim_matches('-');
    let stem = if stem.is_empty() { "image" } else { stem };
    let directory = command.payload.target_directory.trim().replace('\\', "/");

    let mut created_path = None;
    for index in 1..=1000 {
        let filename = if index == 1 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let relative_path = if directory.is_empty() {
            filename
        } else {
            format!("{directory}/{filename}")
        };
        match foundation.code_workspaces.create_file_bytes(
            &command.payload.workspace_id,
            &relative_path,
            &bytes,
        ) {
            Ok(_) => {
                created_path = Some(relative_path);
                break;
            }
            Err(HiveoryWorkspaceError::Io(error))
                if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(workspace_error(error)),
        }
    }
    let relative_path = created_path
        .ok_or_else(|| validation_error("No available filename could be found for this image."))?;
    Ok(response(
        &command.request_id,
        CodeImportedAsset { relative_path },
    ))
}

#[tauri::command]
async fn hiveory_query_code_asset(
    request: CodeReadAssetRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeAssetData, ApiError> {
    let source = request.source.trim().replace('\\', "/");
    if source.is_empty()
        || source.starts_with('/')
        || source.contains(':')
        || source.starts_with("//")
    {
        return Err(validation_error(
            "The Markdown image path is not a workspace-relative file.",
        ));
    }
    let directory = Path::new(&request.document_path)
        .parent()
        .and_then(Path::to_str)
        .unwrap_or_default()
        .replace('\\', "/");
    let mut path_parts = directory
        .split('/')
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    for part in source.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if path_parts.pop().is_none() {
                    return Err(validation_error(
                        "The Markdown image path leaves the workspace.",
                    ));
                }
            }
            value => path_parts.push(value.to_owned()),
        }
    }
    let relative_path = path_parts.join("/");
    let bytes = foundation
        .code_workspaces
        .read_file_bytes(&request.workspace_id, &relative_path)
        .map_err(workspace_error)?;
    let mime_type = match Path::new(&relative_path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => {
            return Err(validation_error(
                "The Markdown image type is not supported.",
            ))
        }
    };
    Ok(CodeAssetData {
        data_base64: STANDARD.encode(bytes),
        mime_type: mime_type.to_owned(),
    })
}

#[tauri::command]
async fn hiveory_command_rename_code_file(
    command: CommandEnvelope<CodeRenameFileRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeRenameFileResult>, ApiError> {
    validate_code_command(&command)?;
    let current = foundation
        .persistence
        .code_layout(&command.payload.workspace_id)
        .await
        .map_err(database_error)?
        .unwrap_or_else(|| default_layout(&command.payload.workspace_id));
    if current.revision != command.payload.expected_revision {
        return Err(application_error(
            "layout_conflict",
            "Pane layout was modified elsewhere.",
            RetryClass::AfterUserAction,
        ));
    }
    let node = current
        .nodes
        .iter()
        .find(|node| {
            node.pane_id == command.payload.pane_id
                && node.resource_id.as_deref() == Some(&command.payload.relative_path)
        })
        .ok_or_else(|| validation_error("Markdown pane no longer owns this file."))?;
    if !matches!(node.kind, hiveory_protocol::CodePaneKind::Markdown) {
        return Err(validation_error(
            "Only Markdown documents can be renamed here.",
        ));
    }
    let document = foundation
        .code_workspaces
        .rename_file(
            &command.payload.workspace_id,
            &command.payload.relative_path,
            &command.payload.new_relative_path,
            command.payload.expected_fingerprint.as_deref(),
        )
        .map_err(workspace_error)?;
    let mut layout = current;
    let pane = layout
        .nodes
        .iter_mut()
        .find(|node| node.pane_id == command.payload.pane_id)
        .expect("validated pane");
    pane.resource_id = Some(document.relative_path.clone());
    pane.title = Some(
        document
            .relative_path
            .rsplit('/')
            .next()
            .unwrap_or("untitled.md")
            .to_owned(),
    );
    let layout = foundation
        .persistence
        .mutate_code_layout(
            &command.payload.workspace_id,
            command.payload.expected_revision,
            &layout,
        )
        .await
        .map_err(database_error)?;
    Ok(response(
        &command.request_id,
        CodeRenameFileResult { layout, document },
    ))
}

#[tauri::command]
async fn hiveory_command_save_code_layout(
    command: CommandEnvelope<CodeSaveLayoutRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_query_code_layout_presets(
    query: CodeLayoutPresetQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<CodeLayoutPresetSummary>, ApiError> {
    foundation
        .code_workspaces
        .summary(&query.workspace_id)
        .map_err(workspace_error)?;
    foundation
        .persistence
        .code_layout_presets(&query.workspace_id)
        .await
        .map_err(database_error)
}

#[tauri::command]
async fn hiveory_command_create_code_layout_preset(
    command: CommandEnvelope<CodeLayoutPresetCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeLayoutPresetSummary>, ApiError> {
    validate_code_command(&command)?;
    validate_code_layout_preset_fields(
        &command.payload.name,
        command.payload.description.as_deref(),
    )?;
    if command.payload.workspace_id != command.payload.layout.workspace_id {
        return Err(validation_error("Layout and workspace IDs must match."));
    }
    validate_layout(&command.payload.layout)
        .map_err(|error| validation_error(format!("Invalid pane layout: {error}")))?;
    foundation
        .code_workspaces
        .summary(&command.payload.workspace_id)
        .map_err(workspace_error)?;
    let preset = foundation
        .persistence
        .create_code_layout_preset(&command.payload)
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, preset))
}

#[tauri::command]
async fn hiveory_command_update_code_layout_preset(
    command: CommandEnvelope<CodeLayoutPresetUpdateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeLayoutPresetSummary>, ApiError> {
    validate_code_command(&command)?;
    validate_code_layout_preset_fields(
        &command.payload.name,
        command.payload.description.as_deref(),
    )?;
    if let Some(layout) = &command.payload.layout {
        if command.payload.workspace_id != layout.workspace_id {
            return Err(validation_error("Layout and workspace IDs must match."));
        }
        validate_layout(layout)
            .map_err(|error| validation_error(format!("Invalid pane layout: {error}")))?;
    }
    let preset = foundation
        .persistence
        .update_code_layout_preset(&command.payload)
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, preset))
}

#[tauri::command]
async fn hiveory_command_open_code_layout_preset(
    command: CommandEnvelope<CodeLayoutPresetOpenRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodePaneLayout>, ApiError> {
    validate_code_command(&command)?;
    let preset = foundation
        .persistence
        .code_layout_preset(&command.payload.workspace_id, &command.payload.preset_id)
        .await
        .map_err(database_error)?
        .ok_or_else(|| validation_error("Layout preset was not found."))?;
    validate_layout(&preset.layout)
        .map_err(|error| validation_error(format!("Stored layout preset is invalid: {error}")))?;
    let layout = foundation
        .persistence
        .mutate_code_layout(
            &command.payload.workspace_id,
            command.payload.expected_revision,
            &preset.layout,
        )
        .await
        .map_err(|error| {
            if error.to_string().contains("layout_conflict") {
                application_error(
                    "layout_conflict",
                    "Pane layout was modified elsewhere.",
                    RetryClass::AfterUserAction,
                )
            } else {
                database_error(error)
            }
        })?;
    Ok(response(&command.request_id, layout))
}

#[tauri::command]
async fn hiveory_query_code_launch_presets(
    query: CodeLaunchPresetQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<Vec<CodeLaunchPresetSummary>, ApiError> {
    foundation
        .code_workspaces
        .summary(&query.workspace_id)
        .map_err(workspace_error)?;
    foundation
        .persistence
        .code_launch_presets(&query.workspace_id)
        .await
        .map_err(database_error)
}

#[tauri::command]
async fn hiveory_command_create_code_launch_preset(
    command: CommandEnvelope<CodeLaunchPresetCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeLaunchPresetSummary>, ApiError> {
    validate_code_command(&command)?;
    validate_code_launch_preset(
        &foundation,
        &command.payload.name,
        &command.payload.entries,
        false,
    )?;
    foundation
        .code_workspaces
        .summary(&command.payload.workspace_id)
        .map_err(workspace_error)?;
    let preset = foundation
        .persistence
        .create_code_launch_preset(&command.payload)
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, preset))
}

#[tauri::command]
async fn hiveory_command_update_code_launch_preset(
    command: CommandEnvelope<CodeLaunchPresetUpdateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeLaunchPresetSummary>, ApiError> {
    validate_code_command(&command)?;
    validate_code_launch_preset(
        &foundation,
        &command.payload.name,
        &command.payload.entries,
        false,
    )?;
    let preset = foundation
        .persistence
        .update_code_launch_preset(&command.payload)
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, preset))
}

#[tauri::command]
async fn hiveory_command_open_code_launch_preset(
    command: CommandEnvelope<CodeLaunchPresetOpenRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeLaunchPresetOpenResult>, ApiError> {
    validate_code_command(&command)?;
    let preset = foundation
        .persistence
        .code_launch_preset(&command.payload.workspace_id, &command.payload.preset_id)
        .await
        .map_err(database_error)?
        .ok_or_else(|| validation_error("Launch preset was not found."))?;
    validate_code_launch_preset(&foundation, &preset.name, &preset.entries, true)?;

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
            "Pane layout was modified elsewhere.",
            RetryClass::AfterUserAction,
        ));
    }
    if !is_empty_workspace_layout(&current_layout) {
        return Err(validation_error(
            "Presets can only be opened before the first pane is created.",
        ));
    }

    let launch_entries = normalize_launch_preset_pane_titles(&preset.entries);
    let (next_layout, targets) =
        build_code_launch_preset_layout(&command.payload.workspace_id, &launch_entries)?;
    let layout = foundation
        .persistence
        .mutate_code_layout(
            &command.payload.workspace_id,
            command.payload.expected_revision,
            &next_layout,
        )
        .await
        .map_err(|error| {
            if error.to_string().contains("layout_conflict") {
                application_error(
                    "layout_conflict",
                    "Pane layout was modified elsewhere.",
                    RetryClass::AfterUserAction,
                )
            } else {
                database_error(error)
            }
        })?;
    Ok(response(
        &command.request_id,
        CodeLaunchPresetOpenResult { layout, targets },
    ))
}

#[tauri::command]
async fn hiveory_query_code_git_status(
    request: CodeGitStatusRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeGitStatus, ApiError> {
    foundation
        .code_workspaces
        .require(
            &request.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::ReadGit,
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
async fn hiveory_query_code_git_diff(
    request: CodeGitDiffRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeGitDiff, ApiError> {
    foundation
        .code_workspaces
        .require(
            &request.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::ReadGit,
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
            request.staged,
        )
        .map_err(git_error)
}

#[tauri::command]
async fn hiveory_query_code_git_repository(
    request: CodeGitRepositoryRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeGitRepositorySummary, ApiError> {
    foundation
        .code_workspaces
        .require(
            &request.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::ReadGit,
        )
        .map_err(workspace_error)?;
    let root = foundation
        .code_workspaces
        .root_path(&request.workspace_id)
        .map_err(workspace_error)?;
    foundation
        .code_git
        .repository_summary(&request.workspace_id, &root)
        .map_err(git_error)
}

#[tauri::command]
async fn hiveory_query_code_hosted_tracking(
    request: CodeHostedTrackingRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeHostedTracking, ApiError> {
    foundation
        .code_workspaces
        .require(
            &request.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::ReadGit,
        )
        .map_err(workspace_error)?;
    let root = foundation
        .code_workspaces
        .root_path(&request.workspace_id)
        .map_err(workspace_error)?;
    Ok(hosted_source::load_tracking(&foundation.persistence, &request.workspace_id, &root).await)
}

#[tauri::command]
async fn hiveory_query_task_sources(
    request: TaskSourceQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<TaskSourceSnapshot, ApiError> {
    foundation
        .code_workspaces
        .require(
            &request.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::ReadGit,
        )
        .map_err(workspace_error)?;
    let root = foundation
        .code_workspaces
        .root_path(&request.workspace_id)
        .map_err(workspace_error)?;
    Ok(task_sources::snapshot(
        &foundation.persistence,
        foundation.secrets.as_ref(),
        &request.workspace_id,
        &root,
    )
    .await)
}

#[tauri::command]
async fn hiveory_command_connect_task_source(
    request: TaskSourceConnectRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<hiveory_protocol::TaskSourceSummary, ApiError> {
    foundation
        .code_workspaces
        .require(
            &request.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::ReadGit,
        )
        .map_err(workspace_error)?;
    task_sources::connect(
        &foundation.persistence,
        foundation.secrets.as_ref(),
        &request,
    )
    .await
    .map_err(validation_error)
}

#[tauri::command]
async fn hiveory_command_remove_task_source(
    request: TaskSourceIdRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<bool, ApiError> {
    foundation
        .code_workspaces
        .require(
            &request.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::ReadGit,
        )
        .map_err(workspace_error)?;
    task_sources::remove(
        &foundation.persistence,
        foundation.secrets.as_ref(),
        &request.source_id,
    )
    .await
    .map_err(validation_error)?;
    Ok(true)
}

#[tauri::command]
async fn hiveory_command_stage_code_git(
    command: CommandEnvelope<CodeGitStageRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .stage(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            &command.payload.relative_paths,
            command.payload.stage,
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_discard_code_git(
    command: CommandEnvelope<CodeGitDiscardRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .discard(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            &command.payload.relative_paths,
            command.payload.include_untracked,
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_commit_code_git(
    command: CommandEnvelope<CodeGitCommitRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .commit(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            &command.payload.message,
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_create_code_git_branch(
    command: CommandEnvelope<CodeGitBranchCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .create_branch(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            &command.payload.name,
            command.payload.start_point.as_deref(),
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_checkout_code_git_branch(
    command: CommandEnvelope<CodeGitBranchCheckoutRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .checkout_branch(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            &command.payload.name,
            command.payload.create,
            command.payload.start_point.as_deref(),
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_delete_code_git_branch(
    command: CommandEnvelope<CodeGitBranchDeleteRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .delete_branch(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            &command.payload.name,
            command.payload.force,
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_fetch_code_git(
    command: CommandEnvelope<CodeGitRemoteRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .fetch(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            command.payload.remote.as_deref(),
            command.payload.branch.as_deref(),
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_pull_code_git(
    command: CommandEnvelope<CodeGitRemoteRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .pull(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            command.payload.remote.as_deref(),
            command.payload.branch.as_deref(),
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_push_code_git(
    command: CommandEnvelope<CodeGitRemoteRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .push(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            command.payload.remote.as_deref(),
            command.payload.branch.as_deref(),
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_save_code_git_stash(
    command: CommandEnvelope<CodeGitStashSaveRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .stash_save(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            command.payload.message.as_deref(),
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_pop_code_git_stash(
    command: CommandEnvelope<CodeGitStashIndexRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .stash_pop(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            command.payload.index,
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_drop_code_git_stash(
    command: CommandEnvelope<CodeGitStashIndexRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeGitOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = foundation
        .code_git
        .stash_drop(
            &command.payload.workspace_id,
            Path::new(&workspace.root_path),
            command.payload.index,
        )
        .map_err(git_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_create_code_hosted_issue(
    command: CommandEnvelope<CodeHostedIssueCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeHostedOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = hosted_source::create_issue(
        &command.payload.workspace_id,
        Path::new(&workspace.root_path),
        &command.payload.title,
        &command.payload.body,
        &command.payload.labels,
    )
    .await
    .map_err(hosted_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_update_code_hosted_issue(
    command: CommandEnvelope<CodeHostedIssueUpdateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeHostedOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = hosted_source::update_issue(
        &command.payload.workspace_id,
        Path::new(&workspace.root_path),
        command.payload.number,
        command.payload.title.as_deref(),
        command.payload.body.as_deref(),
        command.payload.state,
    )
    .await
    .map_err(hosted_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_action_code_hosted_issue(
    command: CommandEnvelope<CodeHostedIssueActionRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeHostedOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = hosted_source::issue_action(
        &command.payload.workspace_id,
        Path::new(&workspace.root_path),
        command.payload.number,
        command.payload.action,
    )
    .await
    .map_err(hosted_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_create_code_hosted_pull_request(
    command: CommandEnvelope<CodeHostedPullRequestCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeHostedOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = hosted_source::create_pull_request(
        &command.payload.workspace_id,
        Path::new(&workspace.root_path),
        &command.payload.title,
        &command.payload.body,
        command.payload.base_branch.as_deref(),
        command.payload.draft,
    )
    .await
    .map_err(hosted_error)?;
    Ok(response(&command.request_id, result))
}

#[tauri::command]
async fn hiveory_command_action_code_hosted_pull_request(
    command: CommandEnvelope<CodeHostedPullRequestActionRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodeHostedOperationResult>, ApiError> {
    validate_code_command(&command)?;
    let workspace = foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteGit,
        )
        .map_err(workspace_error)?;
    let result = hosted_source::pull_request_action(
        &command.payload.workspace_id,
        Path::new(&workspace.root_path),
        command.payload.number,
        command.payload.action,
    )
    .await
    .map_err(hosted_error)?;
    Ok(response(&command.request_id, result))
}

async fn prepare_cli_session_integration(
    foundation: &HiveoryFoundation,
    app: tauri::AppHandle,
    browser: BrowserManager,
    workspace_id: String,
    adapter_id: Option<&str>,
    requested_session_id: Option<String>,
) -> Result<Option<hiveory_protocol::CodeCliSessionIntegration>, ApiError> {
    let Some(adapter_id) = adapter_id.and_then(canonical_code_adapter_id) else {
        return Ok(None);
    };

    let session_id = requested_session_id.unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
    // A bridged CLI can summon another pane. The bridge factory returns an
    // erased Send future, preventing the recursive handler/tool type cycle.
    let bridge =
        start_cli_session_bridge(foundation, app, browser, session_id.clone(), workspace_id)
            .await?;
    let session_root = foundation
        .code_workspaces_root
        .parent()
        .unwrap_or(&foundation.code_workspaces_root)
        .join("cli-sessions")
        .join(&session_id);
    std::fs::create_dir_all(&session_root).map_err(|error| {
        application_error(
            "cli_session_setup_failed",
            error.to_string(),
            RetryClass::Safe,
        )
    })?;

    let skill_store =
        hiveory_persistence::agent::HiveoryAgentStore::new(foundation.persistence.clone());
    let mut instructions = String::from(
        "# Hiveory session skills\n\nThese local skills apply only to this CLI session. Follow a skill when the user request matches its purpose. Plugin tools are provided by the `hiveory` MCP server and use locally validated connections.\n",
    );
    let participant_address = if session_id.starts_with("cli-worker-") {
        format!("worker:{session_id}")
    } else {
        format!("coordinator:{session_id}")
    };
    instructions.push_str(&format!(
        "\n## Hiveory orchestration identity\n\nYour durable mailbox address is `{participant_address}`. Hiveory orchestration is available in this pane: call `session.status` before saying it is unavailable. When another agent assigns work, use `orchestration.inbox` with the run ID (the recipient defaults to this address), then call `orchestration.acknowledge_message` after handling each delivery. Use `orchestration.assign_task` to open a visible worker pane and deliver a tracked task. A visible worker completes by calling `orchestration.report_completion`; use `orchestration.wait` rather than polling for replies.\n"
    ));
    instructions.push_str(
        "\n## Direct pane commands\n\nFor a user request to open a coding-agent pane, call `agent_panes.open` immediately when the adapter, model, launch mode, or title is specified. Pass every specified value in that one call. Do not first open Codex, inspect source files, read skills, list adapters, list panes, or probe the bridge. The successful response is the authoritative record: retain its `pane_id` and returned title. When the user later refers to the previous agent, use `agent_panes.rename` with its pane ID; if the ID is unavailable, omit it and Hiveory will select the most recently opened coding-agent pane. Never claim a pane was opened or renamed until the corresponding tool succeeds and returns the saved state.\n",
    );
    for skill in skill_store.catalog().await.map_err(|error| {
        application_error(
            "skill_catalog_unavailable",
            error.to_string(),
            RetryClass::Safe,
        )
    })? {
        if !skill.valid {
            continue;
        }
        if let Some((summary, body)) =
            skill_store
                .skill_package(&skill.id)
                .await
                .map_err(|error| {
                    application_error(
                        "skill_catalog_unavailable",
                        error.to_string(),
                        RetryClass::Safe,
                    )
                })?
        {
            instructions.push_str(&format!(
                "\n## {} (`{}`)\n\n{}\n\n{}\n",
                summary.name, summary.id, summary.description, body
            ));
        }
    }
    let instructions_path = session_root.join("HIVEORY_SKILLS.md");
    std::fs::write(&instructions_path, instructions).map_err(|error| {
        application_error(
            "cli_session_setup_failed",
            error.to_string(),
            RetryClass::Safe,
        )
    })?;

    let bridge_command = std::env::current_exe()
        .map_err(|error| {
            application_error(
                "cli_session_setup_failed",
                error.to_string(),
                RetryClass::Safe,
            )
        })?
        .to_string_lossy()
        .into_owned();
    let bridge_args = vec![
        "--plugin-bridge".to_owned(),
        "--database".to_owned(),
        foundation.database_path.to_string_lossy().into_owned(),
        "--session-id".to_owned(),
        session_id,
        "--endpoint".to_owned(),
        bridge.endpoint,
        "--token".to_owned(),
        bridge.token,
    ];
    let config = if adapter_id == "opencode" {
        serde_json::json!({
            "$schema": "https://opencode.ai/config.json",
            "instructions": [instructions_path.to_string_lossy()],
            // OpenCode expects named servers directly under `mcp`.  Keeping
            // this shape canonical matters: a nested `mcp.servers` object can
            // appear in a resolved config but is not the documented contract
            // and has led to panes that start without their Hiveory tools.
            "mcp": {
                "hiveory": {
                    "type": "local",
                    "command": std::iter::once(bridge_command.clone()).chain(bridge_args.clone()).collect::<Vec<_>>(),
                    "enabled": true,
                    "timeout": 10_000
                }
            }
        })
    } else {
        serde_json::json!({
            "mcpServers": {
                "hiveory": {
                    "type": "stdio",
                    "command": bridge_command,
                    "args": bridge_args
                }
            }
        })
    };
    let mcp_config_path = session_root.join(if adapter_id == "opencode" {
        "opencode.json"
    } else {
        "mcp.json"
    });
    std::fs::write(
        &mcp_config_path,
        serde_json::to_vec_pretty(&config).map_err(|error| {
            application_error(
                "cli_session_setup_failed",
                error.to_string(),
                RetryClass::Safe,
            )
        })?,
    )
    .map_err(|error| {
        application_error(
            "cli_session_setup_failed",
            error.to_string(),
            RetryClass::Safe,
        )
    })?;

    let integration = hiveory_protocol::CodeCliSessionIntegration {
        bridge_command: config["mcpServers"]["hiveory"]["command"]
            .as_str()
            .unwrap_or_else(|| {
                config["mcp"]["hiveory"]["command"][0]
                    .as_str()
                    .unwrap_or_default()
            })
            .to_owned(),
        bridge_args: if adapter_id == "opencode" {
            config["mcp"]["hiveory"]["command"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .skip(1)
                        .filter_map(|item| item.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default()
        } else {
            config["mcpServers"]["hiveory"]["args"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default()
        },
        mcp_config_path: mcp_config_path.to_string_lossy().into_owned(),
        instructions_path: instructions_path.to_string_lossy().into_owned(),
    };
    if adapter_id == "antigravity" {
        configure_antigravity_session_bridge(&integration).await?;
    }
    Ok(Some(integration))
}

/// Antigravity's CLI exposes MCP only through its own server registry rather
/// than a per-process config flag. Replace the Hiveory-owned entry before
/// launch: `mcp add` alone leaves the old endpoint in place on versions that
/// treat an existing name as an error, which was the source of stale bridges
/// after a desktop restart.
async fn configure_antigravity_session_bridge(
    integration: &hiveory_protocol::CodeCliSessionIntegration,
) -> Result<(), ApiError> {
    let (program, prefix) = resolved_adapter_command("antigravity").ok_or_else(|| {
        application_error(
            "antigravity_mcp_setup_failed",
            "Antigravity is not installed on this host.".to_owned(),
            RetryClass::Safe,
        )
    })?;
    let mut remove = tokio::process::Command::new(program.clone());
    remove.args(prefix.clone());
    let _ = remove
        .args(["mcp", "remove", "hiveory-desktop"])
        .status()
        .await;
    let mut command = tokio::process::Command::new(program);
    command.args(prefix);
    let status = command
        .args([
            "mcp",
            "add",
            "hiveory-desktop",
            &integration.bridge_command,
            "--",
        ])
        .args(&integration.bridge_args)
        .status()
        .await
        .map_err(|error| {
            application_error(
                "antigravity_mcp_setup_failed",
                format!("Could not configure Antigravity for this Hiveory session: {error}"),
                RetryClass::Safe,
            )
        })?;
    if !status.success() {
        return Err(application_error(
            "antigravity_mcp_setup_failed",
            "Antigravity could not register Hiveory's local session bridge.".to_owned(),
            RetryClass::Safe,
        ));
    }
    Ok(())
}

#[tauri::command]
async fn hiveory_command_start_code_terminal(
    command: CommandEnvelope<CodeTerminalStartRequest>,
    foundation: State<'_, HiveoryFoundation>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
    channel: Channel<CodeTerminalEvent>,
) -> Result<ResponseEnvelope<CodeTerminalSummary>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::ExecuteProcesses,
        )
        .map_err(workspace_error)?;
    let root = foundation
        .code_workspaces
        .root_path(&command.payload.workspace_id)
        .map_err(workspace_error)?;
    let mut payload = command.payload.clone();
    if payload.kind == hiveory_protocol::CodeTerminalKind::CodingAgent {
        payload.session_integration = prepare_cli_session_integration(
            &foundation,
            app,
            (*browser).clone(),
            payload.workspace_id.clone(),
            payload.adapter_id.as_deref(),
            None,
        )
        .await?;
    }
    let summary = foundation
        .terminal_host
        .start(&payload, &root, None, None)
        .await
        .map_err(terminal_host_error)?;
    forward_terminal_events(
        foundation.terminal_host.clone(),
        summary.id.clone(),
        0,
        channel,
    );
    foundation
        .audit
        .record(
            "code.terminal.start",
            "success",
            "info",
            Some(&summary.id),
            Some(
                if summary.kind == hiveory_protocol::CodeTerminalKind::CodingAgent {
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
async fn hiveory_command_write_code_terminal(
    command: CommandEnvelope<CodeTerminalInputRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .terminal_host
        .write(&command.payload)
        .await
        .map_err(terminal_host_error)?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn hiveory_command_resize_code_terminal(
    command: CommandEnvelope<CodeTerminalResizeRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let resized = foundation
        .terminal_host
        .resize(&command.payload)
        .await
        .map_err(terminal_host_error)?;
    Ok(response(&command.request_id, resized))
}

#[tauri::command]
async fn hiveory_command_stop_code_terminal(
    command: CommandEnvelope<CodeTerminalStopRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let stopped = foundation
        .terminal_host
        .stop(&command.payload)
        .await
        .map_err(terminal_host_error)?;
    Ok(response(&command.request_id, stopped))
}

#[tauri::command]
async fn hiveory_query_code_terminal_history(
    terminal_id: String,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<bool, ApiError> {
    foundation
        .persistence
        .code_terminal_session(&terminal_id)
        .await
        .map_err(database_error)?
        .map(|session| session.history_enabled)
        .ok_or_else(|| validation_error("Terminal session was not found."))
}

#[tauri::command]
async fn hiveory_command_set_code_terminal_history(
    command: CommandEnvelope<CodeTerminalHistorySettingRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let changed = foundation
        .terminal_host
        .set_history_enabled(&command.payload.terminal_id, command.payload.enabled)
        .await
        .map_err(terminal_host_error)?;
    if !changed {
        return Err(validation_error("Terminal session was not found."));
    }
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn hiveory_command_browser_open(
    command: CommandEnvelope<BrowserOpenRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<BrowserRuntimeState>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::OpenPreview,
        )
        .map_err(workspace_error)?;
    if command.payload.browser_id.trim().is_empty() {
        return Err(validation_error("A browser resource is required."));
    }
    // Native child-webview construction must run on Tauri's UI thread.  The
    // command itself is async and may execute on a worker, which previously
    // caused the browser pane to fail during startup with an opaque IPC error.
    let browser_manager = (*browser).clone();
    let browser_request = command.payload.clone();
    let browser_app = app.clone();
    let (sender, receiver) = oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(browser_manager.open(&browser_app, &browser_request));
    })
    .map_err(|error| browser_error(error.to_string()))?;
    receiver
        .await
        .map_err(|_| browser_error("The Browser startup task was cancelled.".to_owned()))?
        .map(|state| response(&command.request_id, state))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_browser_navigate(
    command: CommandEnvelope<BrowserNavigationRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserRuntimeState>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let request = command.payload.clone();
    let browser_app = app.clone();
    let state = run_browser_on_main_thread(app, move || {
        browser_manager.navigate(&browser_app, &request)
    })
    .await?;
    Ok(response(&command.request_id, state))
}

#[tauri::command]
async fn hiveory_command_browser_back(
    command: CommandEnvelope<BrowserIdRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserRuntimeState>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let browser_id = command.payload.browser_id.clone();
    let browser_app = app.clone();
    let state =
        run_browser_on_main_thread(app, move || browser_manager.back(&browser_app, &browser_id))
            .await?;
    Ok(response(&command.request_id, state))
}

#[tauri::command]
async fn hiveory_command_browser_forward(
    command: CommandEnvelope<BrowserIdRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserRuntimeState>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let browser_id = command.payload.browser_id.clone();
    let browser_app = app.clone();
    let state = run_browser_on_main_thread(app, move || {
        browser_manager.forward(&browser_app, &browser_id)
    })
    .await?;
    Ok(response(&command.request_id, state))
}

#[tauri::command]
async fn hiveory_command_browser_reload(
    command: CommandEnvelope<BrowserIdRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserRuntimeState>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let browser_id = command.payload.browser_id.clone();
    let browser_app = app.clone();
    let state = run_browser_on_main_thread(app, move || {
        browser_manager.reload(&browser_app, &browser_id)
    })
    .await?;
    Ok(response(&command.request_id, state))
}

#[tauri::command]
async fn hiveory_command_browser_set_bounds(
    command: CommandEnvelope<BrowserBoundsRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let bounds = &command.payload;
    if !bounds.x.is_finite()
        || !bounds.y.is_finite()
        || !bounds.width.is_finite()
        || !bounds.height.is_finite()
        || bounds.x < 0.0
        || bounds.y < 0.0
        || bounds.width < 0.0
        || bounds.height < 0.0
    {
        return Err(validation_error(
            "Browser bounds must be finite and non-negative.",
        ));
    }
    let browser_manager = (*browser).clone();
    let request = bounds.clone();
    run_browser_on_main_thread(app, move || browser_manager.set_bounds(&request)).await?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn hiveory_command_browser_focus(
    command: CommandEnvelope<BrowserIdRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let browser_id = command.payload.browser_id.clone();
    run_browser_on_main_thread(app, move || browser_manager.focus(&browser_id)).await?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn hiveory_command_browser_close(
    command: CommandEnvelope<BrowserIdRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let browser_id = command.payload.browser_id.clone();
    run_browser_on_main_thread(app, move || browser_manager.close(&browser_id)).await?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
fn hiveory_query_browser_configuration(
    browser: State<'_, BrowserManager>,
) -> Result<BrowserConfiguration, ApiError> {
    browser.configuration().map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_browser_create_profile(
    command: CommandEnvelope<BrowserProfileRequest>,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserConfiguration>, ApiError> {
    validate_code_command(&command)?;
    browser
        .create_profile(&command.payload)
        .map(|configuration| response(&command.request_id, configuration))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_browser_delete_profile(
    command: CommandEnvelope<BrowserProfileIdRequest>,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserConfiguration>, ApiError> {
    validate_code_command(&command)?;
    browser
        .delete_profile(&command.payload)
        .map(|configuration| response(&command.request_id, configuration))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_browser_update_settings(
    command: CommandEnvelope<BrowserSettingsRequest>,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserConfiguration>, ApiError> {
    validate_code_command(&command)?;
    browser
        .update_settings(&command.payload)
        .map(|configuration| response(&command.request_id, configuration))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_browser_switch_profile(
    command: CommandEnvelope<BrowserSwitchProfileRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserRuntimeState>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let request = command.payload.clone();
    let browser_app = app.clone();
    let state = run_browser_on_main_thread(app, move || {
        browser_manager.switch_profile(&browser_app, &request)
    })
    .await?;
    Ok(response(&command.request_id, state))
}

#[tauri::command]
async fn hiveory_command_browser_start_capture(
    command: CommandEnvelope<BrowserCaptureRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let request = command.payload.clone();
    let started =
        run_browser_on_main_thread(app, move || browser_manager.start_capture(&request)).await?;
    Ok(response(&command.request_id, started))
}

#[tauri::command]
fn hiveory_command_browser_copy_text(
    command: CommandEnvelope<BrowserClipboardRequest>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    if command.payload.text.len() > 4 * 1024 * 1024 {
        return Err(validation_error(
            "The copied Browser text is larger than 4 MB.",
        ));
    }
    let mut clipboard = arboard::Clipboard::new().map_err(|error| {
        browser_error(format!("The system clipboard could not be opened: {error}"))
    })?;
    clipboard.set_text(command.payload.text).map_err(|error| {
        browser_error(format!(
            "The system clipboard could not be written: {error}"
        ))
    })?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
fn hiveory_command_clipboard_read_text(
    command: CommandEnvelope<ClipboardReadRequest>,
) -> Result<ResponseEnvelope<String>, ApiError> {
    validate_code_command(&command)?;
    let mut clipboard = arboard::Clipboard::new().map_err(|error| {
        browser_error(format!("The system clipboard could not be opened: {error}"))
    })?;
    let text = clipboard.get_text().map_err(|error| {
        browser_error(format!("The system clipboard could not be read: {error}"))
    })?;
    if text.len() > 4 * 1024 * 1024 {
        return Err(validation_error("The clipboard text is larger than 4 MB."));
    }
    Ok(response(&command.request_id, text))
}

#[tauri::command]
async fn hiveory_command_browser_cancel_capture(
    command: CommandEnvelope<BrowserIdRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let request = command.payload.clone();
    let cancelled =
        run_browser_on_main_thread(app, move || browser_manager.cancel_capture(&request)).await?;
    Ok(response(&command.request_id, cancelled))
}

#[tauri::command]
async fn hiveory_command_browser_sync_annotations(
    command: CommandEnvelope<BrowserAnnotationSyncRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let request = command.payload.clone();
    let synced =
        run_browser_on_main_thread(app, move || browser_manager.sync_annotations(&request)).await?;
    Ok(response(&command.request_id, synced))
}

#[tauri::command]
async fn hiveory_command_browser_capture_frame(
    command: CommandEnvelope<BrowserIdRequest>,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserFrame>, ApiError> {
    validate_code_command(&command)?;
    browser
        .capture_frame(&command.payload)
        .map(|frame| response(&command.request_id, frame))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_browser_set_viewport(
    command: CommandEnvelope<BrowserViewportRequest>,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserRuntimeState>, ApiError> {
    validate_code_command(&command)?;
    browser
        .set_viewport(&command.payload)
        .map(|state| response(&command.request_id, state))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_browser_set_touch_emulation(
    command: CommandEnvelope<BrowserTouchEmulationRequest>,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<BrowserRuntimeState>, ApiError> {
    validate_code_command(&command)?;
    browser
        .set_touch_emulation(&command.payload)
        .map(|state| response(&command.request_id, state))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_browser_open_devtools(
    command: CommandEnvelope<BrowserIdRequest>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    let browser_manager = (*browser).clone();
    let request = command.payload.clone();
    let opened =
        run_browser_on_main_thread(app, move || browser_manager.open_devtools(&request)).await?;
    Ok(response(&command.request_id, opened))
}

#[tauri::command]
async fn hiveory_command_browser_open_external(
    command: CommandEnvelope<BrowserIdRequest>,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    browser
        .open_external(&command.payload)
        .map(|opened| response(&command.request_id, opened))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_open_external_url(
    command: CommandEnvelope<ExternalUrlRequest>,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_code_command(&command)?;
    browser
        .open_external_url(&command.payload.url)
        .map(|opened| response(&command.request_id, opened))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_query_browser_use_settings(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<BrowserUseSettings, ApiError> {
    let settings = foundation
        .persistence
        .get_setting(BROWSER_USE_SETTINGS_KEY)
        .await
        .map_err(database_error)?
        .and_then(|value| serde_json::from_str::<BrowserUseSettings>(&value).ok())
        .map(sanitize_browser_use_settings)
        .unwrap_or_default();
    Ok(settings)
}

#[tauri::command]
async fn hiveory_command_update_browser_use_settings(
    request: BrowserUseSettingsRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<BrowserUseSettings, ApiError> {
    let settings = sanitize_browser_use_settings(BrowserUseSettings {
        enabled: request.enabled,
        target: request.target,
    });
    let value = serde_json::to_string(&settings).map_err(|error| {
        validation_error(format!(
            "Browser Use settings could not be encoded: {error}"
        ))
    })?;
    foundation
        .persistence
        .set_setting(BROWSER_USE_SETTINGS_KEY, &value)
        .await
        .map_err(database_error)?;
    Ok(settings)
}

#[tauri::command]
async fn hiveory_command_browser_import_cookie_file(
    command: CommandEnvelope<BrowserCookieFileRequest>,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<browser::BrowserImportReport>, ApiError> {
    validate_code_command(&command)?;
    browser
        .import_cookie_file(&command.payload)
        .map(|report| response(&command.request_id, report))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_browser_import_cookie_source(
    command: CommandEnvelope<BrowserCookieSourceRequest>,
    browser: State<'_, BrowserManager>,
) -> Result<ResponseEnvelope<browser::BrowserImportReport>, ApiError> {
    validate_code_command(&command)?;
    browser
        .import_cookie_source(&command.payload)
        .await
        .map(|report| response(&command.request_id, report))
        .map_err(browser_error)
}

#[tauri::command]
async fn hiveory_command_open_code_preview(
    command: CommandEnvelope<CodePreviewRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CodePreviewSummary>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::OpenPreview,
        )
        .map_err(workspace_error)?;
    let url = validate_preview_url(&command.payload.url)?;
    let origin = url.origin().ascii_serialization();
    let label = format!("hiveory-preview-{}", uuid::Uuid::now_v7());
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
            Some("host-validated native child webview with credential-free HTTP and HTTPS URL policy"),
        )
        .await
        .map_err(database_error)?;
    Ok(response(&command.request_id, preview))
}

#[tauri::command]
async fn hiveory_command_apply_code_pane_mutation(
    command: CommandEnvelope<CodePaneMutationRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
            hiveory_code_domain::split_pane(&current_layout, pane_id, *placement)
                .map_err(|e| validation_error(e.to_string()))?
        }
        CodePaneMutation::Rename { pane_id, title } => {
            hiveory_code_domain::rename_pane(&current_layout, pane_id, title)
                .map_err(|e| validation_error(e.to_string()))?
        }
        CodePaneMutation::Move {
            pane_id,
            target_pane_id,
            placement,
        } => hiveory_code_domain::move_pane(&current_layout, pane_id, target_pane_id, *placement)
            .map_err(|e| validation_error(e.to_string()))?,
        CodePaneMutation::Resize {
            split_id,
            ratio_percent,
        } => hiveory_code_domain::resize_split(&current_layout, split_id, *ratio_percent)
            .map_err(|e| validation_error(e.to_string()))?,
        CodePaneMutation::Focus { pane_id } => {
            hiveory_code_domain::focus_pane(&current_layout, pane_id)
                .map_err(|e| validation_error(e.to_string()))?
        }
        CodePaneMutation::Maximize { pane_id } => {
            hiveory_code_domain::set_maximized_pane(&current_layout, pane_id.as_deref())
                .map_err(|e| validation_error(e.to_string()))?
        }
        CodePaneMutation::ApplyPreset {
            preset,
            primary_pane_id,
        } => hiveory_code_domain::apply_layout_preset_with_primary(
            &current_layout,
            *preset,
            primary_pane_id.as_deref(),
        )
        .map_err(|e| validation_error(e.to_string()))?,
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
async fn hiveory_command_launch_code_pane_terminal(
    command: CommandEnvelope<LaunchCodePaneTerminalRequest>,
    foundation: State<'_, HiveoryFoundation>,
    app: tauri::AppHandle,
    browser: State<'_, BrowserManager>,
    channel: Channel<CodeTerminalEvent>,
) -> Result<ResponseEnvelope<LaunchCodePaneTerminalResult>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::ExecuteProcesses,
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

    let pane = current_layout
        .nodes
        .iter()
        .find(|node| node.pane_id == command.payload.pane_id)
        .ok_or_else(|| validation_error("Target pane was not found."))?;

    let launch_key = format!(
        "{}:{}",
        command.payload.workspace_id, command.payload.pane_id
    );
    let _launch_reservation = {
        let mut launches = foundation.code_terminal_launches.lock().map_err(|_| {
            application_error(
                "terminal_launch_lock",
                "Terminal launch lock is unavailable.",
                RetryClass::AfterUserAction,
            )
        })?;
        if !launches.insert(launch_key.clone()) {
            return Err(application_error(
                "terminal_launch_in_progress",
                "A terminal is already launching for this pane.",
                RetryClass::AfterUserAction,
            ));
        }
        CodeTerminalLaunchReservation {
            launches: foundation.code_terminal_launches.clone(),
            key: launch_key,
        }
    };

    if let Some(terminal_id) = pane.resource_id.as_deref() {
        if let Some(existing_terminal) = foundation
            .terminal_host
            .list()
            .await
            .map_err(terminal_host_error)?
            .into_iter()
            .find(|terminal| terminal.id == terminal_id)
            .filter(|terminal| {
                matches!(
                    terminal.state,
                    hiveory_protocol::CodeTerminalState::Running
                        | hiveory_protocol::CodeTerminalState::Starting
                )
            })
        {
            forward_terminal_events(
                foundation.terminal_host.clone(),
                existing_terminal.id.clone(),
                0,
                channel,
            );
            return Ok(response(
                &command.request_id,
                LaunchCodePaneTerminalResult {
                    layout: current_layout,
                    terminal: existing_terminal,
                },
            ));
        }
        // A relaunch is a reconnect/resume operation.  It intentionally does
        // not require the renderer's layout revision and never writes a new
        // resource binding, which removes the stale-revision failure path.
        let persisted = foundation
            .persistence
            .code_terminal_session(terminal_id)
            .await
            .map_err(database_error)?;
        let mut terminal_start = CodeTerminalStartRequest {
            workspace_id: command.payload.workspace_id.clone(),
            kind: command.payload.kind,
            cols: command.payload.cols,
            rows: command.payload.rows,
            adapter_id: command.payload.adapter_id.clone(),
            model: command.payload.model.clone(),
            agent_launch_mode: persisted
                .as_ref()
                .map(|record| record.summary.agent_launch_mode)
                .unwrap_or(command.payload.agent_launch_mode),
            resume_session_id: persisted
                .as_ref()
                .and_then(|record| record.summary.session_id.clone()),
            session_integration: None,
        };
        if terminal_start.kind == hiveory_protocol::CodeTerminalKind::CodingAgent {
            terminal_start.session_integration = prepare_cli_session_integration(
                &foundation,
                app.clone(),
                (*browser).clone(),
                terminal_start.workspace_id.clone(),
                terminal_start.adapter_id.as_deref(),
                None,
            )
            .await?;
        }
        let summary = foundation
            .terminal_host
            .start(
                &terminal_start,
                &root,
                Some(terminal_id.to_owned()),
                persisted.as_ref().map(|record| record.history_enabled),
            )
            .await
            .map_err(terminal_host_error)?;
        forward_terminal_events(
            foundation.terminal_host.clone(),
            summary.id.clone(),
            0,
            channel,
        );
        return Ok(response(
            &command.request_id,
            LaunchCodePaneTerminalResult {
                layout: current_layout,
                terminal: summary,
            },
        ));
    }

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

    let mut terminal_start = CodeTerminalStartRequest {
        workspace_id: command.payload.workspace_id.clone(),
        kind: command.payload.kind,
        cols: command.payload.cols,
        rows: command.payload.rows,
        adapter_id: command.payload.adapter_id.clone(),
        model: command.payload.model.clone(),
        agent_launch_mode: command.payload.agent_launch_mode,
        resume_session_id: None,
        session_integration: None,
    };
    if terminal_start.kind == hiveory_protocol::CodeTerminalKind::CodingAgent {
        terminal_start.session_integration = prepare_cli_session_integration(
            &foundation,
            app,
            (*browser).clone(),
            terminal_start.workspace_id.clone(),
            terminal_start.adapter_id.as_deref(),
            None,
        )
        .await?;
    }
    let summary = foundation
        .terminal_host
        .start(&terminal_start, &root, None, None)
        .await
        .map_err(terminal_host_error)?;

    let default_pane_title = if summary.kind == CodeTerminalKind::CodingAgent {
        generated_pane_title_for_layout(&current_layout)
    } else {
        "Terminal".to_owned()
    };
    let pane_title = pane.title.clone().unwrap_or(default_pane_title);

    let pane_kind = if summary.kind == CodeTerminalKind::CodingAgent {
        hiveory_protocol::CodePaneKind::CodingAgent
    } else {
        hiveory_protocol::CodePaneKind::Terminal
    };

    let mut new_layout = current_layout.clone();
    let node = new_layout
        .nodes
        .iter_mut()
        .find(|node| node.pane_id == command.payload.pane_id)
        .expect("pane was validated before starting the terminal");
    node.kind = pane_kind;
    node.resource_id = Some(summary.id.clone());
    node.title = Some(pane_title);
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
            let _ = foundation
                .terminal_host
                .stop(&CodeTerminalStopRequest {
                    terminal_id: summary.id.clone(),
                    force: true,
                })
                .await;
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

    forward_terminal_events(
        foundation.terminal_host.clone(),
        summary.id.clone(),
        0,
        channel,
    );

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
async fn hiveory_command_open_code_pane_preview(
    command: CommandEnvelope<OpenCodePanePreviewRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<OpenCodePanePreviewResult>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::OpenPreview,
        )
        .map_err(workspace_error)?;

    let url = validate_preview_url(&command.payload.url)?;
    let origin = url.origin().ascii_serialization();
    let preview_id = format!("hiveory-preview-{}", uuid::Uuid::now_v7());
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
    let preview_title = current_layout
        .nodes
        .iter()
        .find(|node| node.pane_id == command.payload.pane_id)
        .and_then(|node| node.title.clone())
        .unwrap_or_else(|| url.host_str().unwrap_or("Preview").to_owned());
    if let Some(node) = new_layout
        .nodes
        .iter_mut()
        .find(|n| n.pane_id == command.payload.pane_id)
    {
        node.kind = hiveory_protocol::CodePaneKind::Preview;
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
async fn hiveory_command_open_code_pane_markdown(
    command: CommandEnvelope<OpenCodePaneMarkdownRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<OpenCodePaneMarkdownResult>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::ReadFiles,
        )
        .map_err(workspace_error)?;

    if !is_markdown_path(&command.payload.relative_path) {
        return Err(validation_error(
            "Only Markdown files can be opened in a Markdown pane.",
        ));
    }

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

    let target = current_layout
        .nodes
        .iter()
        .find(|node| node.pane_id == command.payload.pane_id)
        .ok_or_else(|| validation_error("Target pane was not found."))?;
    if !target.children.is_empty() {
        return Err(validation_error(
            "Only leaf panes can hold a Markdown document.",
        ));
    }

    let document = foundation
        .code_workspaces
        .read_file(
            &command.payload.workspace_id,
            &command.payload.relative_path,
        )
        .map_err(workspace_error)?;
    if document.binary || !is_markdown_path(&document.relative_path) {
        return Err(validation_error(
            "The selected file is not a readable Markdown document.",
        ));
    }

    let mut new_layout = current_layout;
    if let Some(node) = new_layout
        .nodes
        .iter_mut()
        .find(|node| node.pane_id == command.payload.pane_id)
    {
        node.kind = hiveory_protocol::CodePaneKind::Markdown;
        node.resource_id = Some(document.relative_path.clone());
        node.title = Some(
            document
                .relative_path
                .rsplit('/')
                .next()
                .unwrap_or("untitled.md")
                .to_owned(),
        );
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

    foundation
        .persistence
        .save_code_document(
            &command.payload.workspace_id,
            &hiveory_protocol::CodeDocumentSummary {
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
            "code.markdown.open",
            "success",
            "info",
            Some(&command.payload.relative_path),
            Some("opened an existing Markdown document pane"),
        )
        .await
        .map_err(database_error)?;

    Ok(response(
        &command.request_id,
        OpenCodePaneMarkdownResult {
            layout: saved_layout,
            document,
        },
    ))
}

#[tauri::command]
async fn hiveory_command_create_code_pane_markdown(
    command: CommandEnvelope<CreateCodePaneMarkdownRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<CreateCodePaneMarkdownResult>, ApiError> {
    validate_code_command(&command)?;
    foundation
        .code_workspaces
        .require(
            &command.payload.workspace_id,
            hiveory_protocol::CodeWorkspaceCapability::WriteFiles,
        )
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

    let target = current_layout
        .nodes
        .iter()
        .find(|node| node.pane_id == command.payload.pane_id)
        .ok_or_else(|| validation_error("Target pane was not found."))?;
    if !target.children.is_empty() {
        return Err(validation_error(
            "Only leaf panes can hold a Markdown document.",
        ));
    }

    let document =
        create_new_markdown_document(&foundation.code_workspaces, &command.payload.workspace_id)
            .map_err(workspace_error)?;

    let mut new_layout = current_layout;
    if let Some(node) = new_layout
        .nodes
        .iter_mut()
        .find(|node| node.pane_id == command.payload.pane_id)
    {
        node.kind = hiveory_protocol::CodePaneKind::Markdown;
        node.resource_id = Some(document.relative_path.clone());
        node.title = Some(
            document
                .relative_path
                .rsplit('/')
                .next()
                .unwrap_or("untitled.md")
                .to_owned(),
        );
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

    foundation
        .persistence
        .save_code_document(
            &command.payload.workspace_id,
            &hiveory_protocol::CodeDocumentSummary {
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
            "code.markdown.create",
            "success",
            "info",
            Some(&command.payload.workspace_id),
            Some("created a new Markdown document pane"),
        )
        .await
        .map_err(database_error)?;

    Ok(response(
        &command.request_id,
        CreateCodePaneMarkdownResult {
            layout: saved_layout,
            document,
        },
    ))
}

fn create_new_markdown_document(
    workspaces: &HiveoryWorkspaceService,
    workspace_id: &str,
) -> Result<CodeDocument, HiveoryWorkspaceError> {
    for index in 1..=100 {
        let relative_path = if index == 1 {
            "untitled.md".to_owned()
        } else {
            format!("untitled-{index}.md")
        };
        match workspaces.create_file(workspace_id, &relative_path, "") {
            Ok(document) => return Ok(document),
            Err(HiveoryWorkspaceError::Io(error))
                if error.kind() == io::ErrorKind::AlreadyExists =>
            {
                continue
            }
            Err(error) => return Err(error),
        }
    }
    Err(HiveoryWorkspaceError::Io(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "no available untitled Markdown filename was found",
    )))
}

fn is_markdown_path(path: &str) -> bool {
    matches!(
        Path::new(path).extension().and_then(|extension| extension.to_str()),
        Some(extension) if extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
    )
}

#[tauri::command]
async fn hiveory_command_close_code_pane(
    command: CommandEnvelope<CloseCodePaneRequest>,
    foundation: State<'_, HiveoryFoundation>,
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

    let mut terminal_to_stop = None;
    if let Some(pane) = current_layout
        .nodes
        .iter()
        .find(|n| n.pane_id == command.payload.pane_id)
    {
        if matches!(
            pane.kind,
            hiveory_protocol::CodePaneKind::Terminal | hiveory_protocol::CodePaneKind::CodingAgent
        ) {
            if let Some(resource_id) = &pane.resource_id {
                let is_running = foundation
                    .terminal_host
                    .list()
                    .await
                    .map_err(terminal_host_error)?
                    .into_iter()
                    .any(|t| {
                        t.id == *resource_id
                            && matches!(
                                t.state,
                                hiveory_protocol::CodeTerminalState::Running
                                    | hiveory_protocol::CodeTerminalState::Starting
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
                        // Persist the visual close first. Waiting for a CLI to
                        // honour termination made closing a pane feel stalled,
                        // especially for agents with child processes. The
                        // terminal host owns the eventual process cleanup.
                        terminal_to_stop = Some(resource_id.clone());
                    }
                }
            }
        }
    }

    let mutated_layout =
        hiveory_code_domain::close_pane_and_collapse(&current_layout, &command.payload.pane_id)
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

    if let Some(terminal_id) = terminal_to_stop {
        let terminal_host = foundation.terminal_host.clone();
        tauri::async_runtime::spawn(async move {
            let _ = terminal_host
                .stop(&CodeTerminalStopRequest {
                    terminal_id,
                    force: true,
                })
                .await;
        });
    }

    Ok(response(
        &command.request_id,
        CodePaneMutationResult {
            layout: saved_layout,
        },
    ))
}

#[tauri::command]
async fn hiveory_query_code_terminal_snapshot(
    query: CodeTerminalSnapshotQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<CodeTerminalSnapshot, ApiError> {
    foundation
        .terminal_host
        .snapshot(&query)
        .await
        .map_err(terminal_host_error)
}

#[tauri::command]
async fn hiveory_stream_code_terminal_events(
    request: CodeTerminalSubscribeRequest,
    foundation: State<'_, HiveoryFoundation>,
    channel: Channel<CodeTerminalEvent>,
) -> Result<(), ApiError> {
    let mut receiver = foundation
        .terminal_host
        .subscribe(&request)
        .await
        .map_err(terminal_host_error)?;

    while let Ok(event) = receiver.recv().await {
        if event.sequence <= request.after_sequence {
            continue;
        }
        if channel.send(event).is_err() {
            break;
        }
    }
    Ok(())
}

#[tauri::command]
async fn hiveory_query_chat_sidebar(
    query: ChatSidebarQuery,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ChatSidebarPage, ApiError> {
    foundation.chat.sidebar(&query).await.map_err(chat_error)
}

#[tauri::command]
async fn hiveory_query_chat_engines(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ChatEngineCatalog, ApiError> {
    let mut engines = foundation.code_runtime.chat_engines().await;
    let provider = foundation
        .persistence
        .provider_accounts()
        .await
        .map_err(database_error)?
        .into_iter()
        .find(|account| account.id == HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID);
    let provider = provider.unwrap_or_else(|| hiveory_protocol::ProviderAccountSummary {
        id: HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID.to_owned(),
        kind: hiveory_protocol::ProviderKind::OpenAiResponses,
        display_name: "OpenAI Responses".to_owned(),
        default_model: None,
        secret_configured: false,
        enabled: false,
    });
    let provider_ready = provider.enabled && provider.secret_configured;
    let provider_models = vec![ChatModelSummary {
        id: provider
            .default_model
            .clone()
            .unwrap_or_else(|| "default".to_owned()),
        display_name: provider
            .default_model
            .clone()
            .unwrap_or_else(|| "Configured model".to_owned()),
        effort_levels: vec![
            ChatReasoningEffort::Auto,
            ChatReasoningEffort::Low,
            ChatReasoningEffort::Medium,
            ChatReasoningEffort::High,
        ],
        default_effort: ChatReasoningEffort::Auto,
    }];
    engines.insert(
        0,
        ChatEngineSummary {
            id: HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID.to_owned(),
            display_name: provider.display_name,
            executable: "Hosted provider".to_owned(),
            availability: if provider_ready {
                ChatEngineAvailability::Ready
            } else {
                ChatEngineAvailability::Unauthenticated
            },
            detected: true,
            authenticated: provider_ready,
            models: provider_models,
            capabilities: vec![
                hiveory_protocol::CodeAdapterCapability::ModelSelection,
                hiveory_protocol::CodeAdapterCapability::ReasoningEffort,
            ],
            message: (!provider_ready).then_some(
                "Configure an API key in Settings before using the hosted provider.".to_owned(),
            ),
            recovery_action: (!provider_ready)
                .then_some("Open Settings → Provider and save an API key.".to_owned()),
        },
    );
    Ok(ChatEngineCatalog {
        engines,
        generated_at_unix_ms: now_ms(),
    })
}

#[tauri::command]
async fn hiveory_command_create_chat_folder(
    command: CommandEnvelope<ChatFolderCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<ChatFolderSummary>, ApiError> {
    validate_chat_command(&command)?;
    let folder = foundation
        .chat
        .create_folder(&command.payload)
        .await
        .map_err(chat_error)?;
    Ok(response(&command.request_id, folder))
}

#[tauri::command]
async fn hiveory_command_update_chat_folder(
    command: CommandEnvelope<ChatFolderUpdateRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<ChatFolderSummary>, ApiError> {
    validate_chat_command(&command)?;
    let folder = foundation
        .chat
        .update_folder(&command.payload)
        .await
        .map_err(chat_error)?;
    Ok(response(&command.request_id, folder))
}

#[tauri::command]
async fn hiveory_command_delete_chat_folder(
    command: CommandEnvelope<ChatFolderDeleteRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_chat_command(&command)?;
    foundation
        .chat
        .delete_folder(&command.payload)
        .await
        .map_err(chat_error)?;
    Ok(response(&command.request_id, true))
}

#[tauri::command]
async fn hiveory_command_move_chat_to_folder(
    command: CommandEnvelope<ChatConversationFolderRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<ChatConversationDetail>, ApiError> {
    validate_chat_command(&command)?;
    let detail = foundation
        .chat
        .move_to_folder(&command.payload)
        .await
        .map_err(chat_error)?;
    Ok(response(&command.request_id, detail))
}

#[tauri::command]
async fn hiveory_query_chat_conversation(
    conversation_id: String,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ChatConversationDetail, ApiError> {
    foundation
        .chat
        .detail(&conversation_id)
        .await
        .map_err(chat_error)
}

#[tauri::command]
async fn hiveory_query_chat_events(
    query: ChatEventsQuery,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_create_chat(
    command: CommandEnvelope<ChatCreateRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_update_chat(
    command: CommandEnvelope<ChatMetadataRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_delete_chat(
    command: CommandEnvelope<ChatDeleteRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_save_chat_draft(
    command: CommandEnvelope<ChatDraftRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_import_chat_attachments(
    command: CommandEnvelope<ChatAttachmentImportRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<Vec<hiveory_protocol::ChatAttachmentSummary>>, ApiError> {
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
async fn hiveory_command_import_chat_attachment_bytes(
    command: CommandEnvelope<ChatAttachmentBytesRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<ChatAttachmentSummary>, ApiError> {
    validate_chat_command(&command)?;
    foundation
        .chat
        .detail(&command.payload.conversation_id)
        .await
        .map_err(chat_error)?;
    if command.payload.data_base64.len() > 32 * 1024 * 1024 {
        return Err(validation_error("The pasted image is too large."));
    }
    let bytes = STANDARD
        .decode(&command.payload.data_base64)
        .map_err(|_| validation_error("The pasted image data is invalid."))?;
    let stored = foundation
        .artifacts
        .import_bytes(
            &command.payload.display_name,
            &command.payload.mime_type,
            &bytes,
        )
        .map_err(artifact_error)?;
    let summary = foundation
        .chat
        .register_attachment(
            &stored.summary,
            &relative_artifact_path(&stored, &foundation.artifacts),
        )
        .await
        .map_err(chat_error)?;
    if let Some(message_id) = command.payload.message_id.as_deref() {
        foundation
            .chat
            .attach_to_message(
                &command.payload.conversation_id,
                message_id,
                std::slice::from_ref(&summary.id),
            )
            .await
            .map_err(chat_error)?;
    }
    Ok(response(&command.request_id, summary))
}

#[tauri::command]
async fn hiveory_command_delete_chat_attachment(
    command: CommandEnvelope<hiveory_protocol::ChatDeleteAttachmentRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_discard_chat_attachment(
    command: CommandEnvelope<ChatDiscardAttachmentRequest>,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<ResponseEnvelope<bool>, ApiError> {
    validate_chat_command(&command)?;
    let path = foundation
        .chat
        .discard_attachment(&command.payload)
        .await
        .map_err(chat_error)?;
    if let Some(path) = path {
        let _ = foundation.artifacts.remove_relative_path(&path);
    }
    Ok(response(&command.request_id, true))
}

async fn resolve_chat_engine_secret(
    foundation: &HiveoryFoundation,
    engine_id: &str,
    action: &str,
) -> Result<Option<String>, ApiError> {
    if engine_id == HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID {
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
async fn hiveory_command_start_chat_turn(
    command: CommandEnvelope<ChatSendRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_cancel_chat_turn(
    command: CommandEnvelope<ChatTurnRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_retry_chat_turn(
    command: CommandEnvelope<ChatTurnRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
    let default_model = if engine_id == HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID {
        foundation
            .persistence
            .provider_accounts()
            .await
            .map_err(database_error)?
            .into_iter()
            .find(|account| account.id == HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID)
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
async fn hiveory_command_edit_chat_message(
    command: CommandEnvelope<ChatEditRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_branch_chat(
    command: CommandEnvelope<ChatBranchRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_export_chat(
    command: CommandEnvelope<ChatExportRequest>,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_stream_chat_events(
    request: ChatStreamRequest,
    foundation: State<'_, HiveoryFoundation>,
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
    foundation: HiveoryFoundation,
    start: hiveory_persistence::chat::HiveoryChatTurnStart,
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
                        kind: hiveory_protocol::ChatProviderStreamEventKind::Completed,
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
        Err(HiveoryProviderError::Cancelled) => {
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
    foundation: &HiveoryFoundation,
    engine_id: &str,
    secret: Option<&str>,
    request: ChatModelTurnRequest,
    cancellation: CancellationToken,
    callback: Arc<dyn Fn(ChatProviderStreamEvent) + Send + Sync + 'static>,
) -> Result<(), HiveoryProviderError> {
    if engine_id == HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID {
        return foundation
            .provider
            .stream_chat_turn(
                secret.ok_or(HiveoryProviderError::CredentialsUnavailable)?,
                request,
                cancellation,
                callback,
            )
            .await;
    }
    let prompt = render_chat_cli_prompt(&request);
    stream_cli_chat_turn(
        engine_id,
        &request.model,
        request.reasoning_effort,
        &prompt,
        cancellation,
        callback,
    )
    .await
    .map_err(|error| match error {
        HiveoryCodeRuntimeError::Cancelled => HiveoryProviderError::Cancelled,
        other => HiveoryProviderError::Request(other.to_string()),
    })
}

async fn finish_chat_turn_with_error(
    foundation: &HiveoryFoundation,
    start: &hiveory_persistence::chat::HiveoryChatTurnStart,
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
                kind: hiveory_protocol::ChatProviderStreamEventKind::Failed,
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
    foundation: &HiveoryFoundation,
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
    if command.protocol.major != HIVEORY_PROTOCOL_VERSION {
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

fn validate_code_layout_preset_fields(
    name: &str,
    description: Option<&str>,
) -> Result<(), ApiError> {
    if name.trim().is_empty() || name.trim().chars().count() > 120 {
        return Err(validation_error(
            "Preset name must be between 1 and 120 characters.",
        ));
    }
    if description.is_some_and(|value| value.chars().count() > 500) {
        return Err(validation_error(
            "Preset description must be at most 500 characters.",
        ));
    }
    Ok(())
}

fn validate_code_launch_preset(
    foundation: &HiveoryFoundation,
    name: &str,
    entries: &[CodeLaunchPresetEntry],
    require_detected_adapters: bool,
) -> Result<(), ApiError> {
    if name.trim().is_empty() || name.trim().chars().count() > 120 {
        return Err(validation_error(
            "Preset name must be between 1 and 120 characters.",
        ));
    }
    if entries.is_empty() || entries.len() > 16 {
        return Err(validation_error(
            "A preset must contain between 1 and 16 panes.",
        ));
    }
    let adapters = foundation.code_runtime.adapters();
    let mut ids = HashSet::new();
    let mut titles = HashSet::new();
    for entry in entries {
        if entry.id.trim().is_empty() || !ids.insert(entry.id.as_str()) {
            return Err(validation_error(
                "Preset pane IDs must be unique and non-empty.",
            ));
        }
        hiveory_code_domain::validate_title(&entry.title)
            .map_err(|error| validation_error(format!("Invalid preset pane title: {error}")))?;
        if !titles.insert(entry.title.trim().to_lowercase()) {
            return Err(validation_error(
                "Preset pane names must be unique, including case-insensitive duplicates.",
            ));
        }
        match entry.kind {
            CodeLaunchPresetPaneKind::CodingAgent => {
                let adapter_id = entry
                    .adapter_id
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        validation_error("A coding-agent preset pane needs an adapter.")
                    })?;
                let canonical_adapter_id =
                    canonical_code_adapter_id(adapter_id).ok_or_else(|| {
                        validation_error(format!("The {adapter_id} coding agent is not supported."))
                    })?;
                if entry.url.is_some() {
                    return Err(validation_error(
                        "A coding-agent preset pane cannot have a URL.",
                    ));
                }
                if require_detected_adapters
                    && !adapters
                        .iter()
                        .any(|adapter| adapter.id == canonical_adapter_id && adapter.detected)
                {
                    return Err(validation_error(format!(
                        "The {adapter_id} coding agent is not installed on this device."
                    )));
                }
            }
            CodeLaunchPresetPaneKind::Browser => {
                let url = entry
                    .url
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| validation_error("A browser preset pane needs a URL."))?;
                validate_preview_url(url)?;
                if entry.adapter_id.is_some() {
                    return Err(validation_error(
                        "A browser preset pane cannot have an adapter.",
                    ));
                }
            }
            CodeLaunchPresetPaneKind::Terminal | CodeLaunchPresetPaneKind::Markdown => {
                if entry.adapter_id.is_some() || entry.url.is_some() {
                    return Err(validation_error(
                        "Terminal and Markdown preset panes cannot have an adapter or URL.",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn is_empty_workspace_layout(layout: &CodePaneLayout) -> bool {
    layout.nodes.len() == 1
        && layout.root_id == layout.nodes[0].pane_id
        && layout.nodes[0].children.is_empty()
        && layout.nodes[0].kind == CodePaneKind::Empty
        && layout.nodes[0].resource_id.is_none()
}

/// Old preset records used two-word descriptive titles. Presets are workspace
/// setups, so every launch gets a distinct, compact pet name while preserving
/// one-word names that were already assigned by the current preset builder.
const PANE_CODENAMES: &[&str] = &[
    "Biscuit", "Button", "Clover", "Comet", "Doodle", "Fidget", "Gizmo", "Juniper", "Kestrel",
    "Mochi", "Nimbus", "Noodle", "Pebble", "Pickle", "Pippin", "Poppy", "Quartz", "Rocket",
    "Saffron", "Sprout", "Tango", "Waffles", "Whisker", "Wicket", "Ziggy",
];

/// Reserve a creative, compact title for a pane.  This is deliberately host
/// owned so a manual split, a launch preset, and an orchestration worker all
/// use exactly the same collision rules.
fn next_generated_pane_title(used: &mut HashSet<String>) -> String {
    // UUIDv7 carries random bits as well as time ordering, which is available
    // with this application's UUID feature set and prevents a fixed sequence.
    let start = (uuid::Uuid::now_v7().as_u128() as usize) % PANE_CODENAMES.len();
    for offset in 0..PANE_CODENAMES.len() {
        let candidate = PANE_CODENAMES[(start + offset) % PANE_CODENAMES.len()];
        if used.insert(candidate.to_ascii_lowercase()) {
            return candidate.to_owned();
        }
    }
    let base = PANE_CODENAMES[start];
    let mut suffix = 2;
    loop {
        let candidate = format!("{base}{suffix}");
        if used.insert(candidate.to_ascii_lowercase()) {
            return candidate;
        }
        suffix += 1;
    }
}

fn generated_pane_title_for_layout(layout: &CodePaneLayout) -> String {
    let mut used = layout
        .nodes
        .iter()
        .filter_map(|node| node.title.as_deref())
        .map(|title| title.trim().to_ascii_lowercase())
        .filter(|title| !title.is_empty())
        .collect::<HashSet<_>>();
    next_generated_pane_title(&mut used)
}

fn normalize_launch_preset_pane_titles(
    entries: &[CodeLaunchPresetEntry],
) -> Vec<CodeLaunchPresetEntry> {
    let mut used = HashSet::new();
    entries
        .iter()
        .map(|entry| {
            let mut entry = entry.clone();
            let title = entry.title.trim();
            let title_key = title.to_ascii_lowercase();
            if !title.is_empty()
                && !title.chars().any(char::is_whitespace)
                && used.insert(title_key)
            {
                entry.title = title.to_owned();
                return entry;
            }

            entry.title = next_generated_pane_title(&mut used);
            entry
        })
        .collect()
}

fn build_code_launch_preset_layout(
    workspace_id: &str,
    entries: &[CodeLaunchPresetEntry],
) -> Result<(CodePaneLayout, Vec<CodeLaunchPresetLaunchTarget>), ApiError> {
    let mut layout = default_layout(workspace_id);
    for _ in 1..entries.len() {
        let pane_id = layout
            .focused_pane_id
            .clone()
            .ok_or_else(|| validation_error("Workspace layout has no focused pane."))?;
        layout = split_pane(&layout, &pane_id, CodePanePlacement::Right).map_err(|error| {
            validation_error(format!("Could not create preset layout: {error}"))
        })?;
    }
    layout = apply_layout_preset(&layout, CodePanePreset::Tidy)
        .map_err(|error| validation_error(format!("Could not arrange preset layout: {error}")))?;
    let pane_ids = layout
        .nodes
        .iter()
        .filter(|node| node.children.is_empty())
        .map(|node| node.pane_id.clone())
        .collect::<Vec<_>>();
    if pane_ids.len() != entries.len() {
        return Err(validation_error(
            "Preset layout did not create every requested pane.",
        ));
    }
    let targets = pane_ids
        .iter()
        .cloned()
        .zip(entries.iter().cloned())
        .map(|(pane_id, entry)| CodeLaunchPresetLaunchTarget { pane_id, entry })
        .collect::<Vec<_>>();
    for target in &targets {
        let node = layout
            .nodes
            .iter_mut()
            .find(|node| node.pane_id == target.pane_id)
            .ok_or_else(|| validation_error("Preset layout pane was not found."))?;
        node.kind = match target.entry.kind {
            CodeLaunchPresetPaneKind::CodingAgent => CodePaneKind::CodingAgent,
            CodeLaunchPresetPaneKind::Terminal => CodePaneKind::Terminal,
            CodeLaunchPresetPaneKind::Browser => CodePaneKind::Preview,
            CodeLaunchPresetPaneKind::Markdown => CodePaneKind::Markdown,
        };
        node.title = Some(target.entry.title.clone());
    }
    layout.focused_pane_id = targets.first().map(|target| target.pane_id.clone());
    validate_layout(&layout)
        .map_err(|error| validation_error(format!("Invalid preset layout: {error}")))?;
    Ok((layout, targets))
}

async fn ensure_terminal_history_key(
    persistence: &HiveoryPersistence,
    secrets: &HiveorySecretStoreHandle,
) -> Result<String, String> {
    const HISTORY_KEY_SETTING: &str = "code.terminal_history_key_ref";
    if let Some(value) = persistence
        .get_setting(HISTORY_KEY_SETTING)
        .await
        .map_err(|error| error.to_string())?
    {
        let reference = serde_json::from_str::<String>(&value).unwrap_or(value);
        if secrets.get(&reference).is_ok() {
            return Ok(reference);
        }
    }

    // Uuid v7 includes OS-backed randomness and is available through the
    // workspace's existing UUID dependency.  Two independent values provide
    // the 32 bytes required by AES-256-GCM without adding another RNG stack.
    let first = uuid::Uuid::now_v7();
    let second = uuid::Uuid::now_v7();
    let mut key = [0_u8; 32];
    key[..16].copy_from_slice(first.as_bytes());
    key[16..].copy_from_slice(second.as_bytes());
    let encoded = STANDARD.encode(key);
    let reference = secrets.put(&encoded).map_err(|error| error.to_string())?;
    persistence
        .set_setting(
            HISTORY_KEY_SETTING,
            &serde_json::to_string(&reference).map_err(|error| error.to_string())?,
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(reference)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn validate_preview_url(value: &str) -> Result<url::Url, ApiError> {
    browser::normalize_browser_input(value).map_err(validation_error)
}

fn browser_error(message: String) -> ApiError {
    application_error("browser_error", message, RetryClass::AfterUserAction)
}

async fn run_browser_on_main_thread<T, F>(
    app: tauri::AppHandle,
    operation: F,
) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let (sender, receiver) = oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(operation());
    })
    .map_err(|error| browser_error(format!("The Browser UI task could not start: {error}")))?;

    receiver
        .await
        .map_err(|_| browser_error("The Browser UI task was cancelled.".to_owned()))?
        .map_err(browser_error)
}

fn workspace_error(error: HiveoryWorkspaceError) -> ApiError {
    let (code, message, retry) = match error {
        HiveoryWorkspaceError::InvalidRoot(_) => (
            "workspace_invalid_root",
            "The selected workspace folder could not be opened.",
            RetryClass::AfterUserAction,
        ),
        HiveoryWorkspaceError::NotFound => (
            "workspace_not_found",
            "The workspace is no longer available.",
            RetryClass::AfterUserAction,
        ),
        HiveoryWorkspaceError::Untrusted | HiveoryWorkspaceError::CapabilityDenied(_) => (
            "workspace_trust_required",
            "Trust this workspace before using this capability.",
            RetryClass::AfterUserAction,
        ),
        HiveoryWorkspaceError::InvalidPath(_) => (
            "workspace_path_denied",
            "That path is outside the approved workspace policy.",
            RetryClass::AfterUserAction,
        ),
        HiveoryWorkspaceError::InvalidRelationship(_) => (
            "workspace_relationship_invalid",
            "That workspace parent relationship is not valid.",
            RetryClass::AfterUserAction,
        ),
        HiveoryWorkspaceError::FileTooLarge => (
            "code_file_too_large",
            "The file is too large for the inline editor.",
            RetryClass::AfterUserAction,
        ),
        HiveoryWorkspaceError::BinaryFile => (
            "code_binary_file",
            "Binary files cannot be edited in the inline editor.",
            RetryClass::AfterUserAction,
        ),
        HiveoryWorkspaceError::FileConflict => (
            "code_file_conflict",
            "The file changed on disk. Reload it before saving.",
            RetryClass::AfterUserAction,
        ),
        HiveoryWorkspaceError::SymlinkNotAllowed => (
            "code_symlink_denied",
            "Symbolic links are not opened or edited through Code mode.",
            RetryClass::AfterUserAction,
        ),
        HiveoryWorkspaceError::Io(_) => (
            "workspace_io_failed",
            "The workspace filesystem operation failed.",
            RetryClass::Safe,
        ),
    };
    application_error(code, message, retry)
}

fn terminal_host_error(error: HiveoryTerminalHostError) -> ApiError {
    let (code, message): (&str, String) = match error {
        HiveoryTerminalHostError::InvalidDimensions => (
            "terminal_invalid_dimensions",
            "The terminal size is outside the supported range.".to_owned(),
        ),
        HiveoryTerminalHostError::UnsupportedAdapter => (
            "code_adapter_unavailable",
            "The requested coding-agent adapter is unavailable.".to_owned(),
        ),
        HiveoryTerminalHostError::UnsupportedYoloMode => (
            "code_yolo_mode_unavailable",
            "YOLO mode is unavailable for the requested coding-agent adapter.".to_owned(),
        ),
        HiveoryTerminalHostError::Cancelled => (
            "terminal_cancelled",
            "The coding-agent process was cancelled.".to_owned(),
        ),
        HiveoryTerminalHostError::TerminalNotFound => (
            "terminal_not_found",
            "The terminal session is no longer available.".to_owned(),
        ),
        HiveoryTerminalHostError::Operation(message) => ("terminal_operation_failed", message),
    };
    application_error(code, message, RetryClass::AfterUserAction)
}

fn git_error(error: HiveoryGitError) -> ApiError {
    match error {
        HiveoryGitError::NotRepository => application_error(
            "git_not_repository",
            "The workspace is not a Git repository.",
            RetryClass::AfterUserAction,
        ),
        HiveoryGitError::InvalidPath(_) => application_error(
            "git_path_denied",
            "The requested Git path is outside the workspace policy.",
            RetryClass::AfterUserAction,
        ),
        HiveoryGitError::Git(error) => application_error(
            "git_read_failed",
            format!("Git could not complete the operation: {}", error.message()),
            RetryClass::Safe,
        ),
        HiveoryGitError::Io(error) => application_error(
            "git_io_failed",
            format!("Git could not update the repository files: {error}"),
            RetryClass::Safe,
        ),
        HiveoryGitError::InvalidWorktreeName => application_error(
            "git_worktree_name_invalid",
            "The managed worktree name is invalid.",
            RetryClass::AfterUserAction,
        ),
        HiveoryGitError::WorktreeOutsideManagedRoot => application_error(
            "git_worktree_path_denied",
            "The managed worktree path is outside the orchestration directory.",
            RetryClass::AfterUserAction,
        ),
        HiveoryGitError::WorktreeDirty(path) => application_error(
            "git_worktree_dirty",
            format!("The worktree has uncommitted changes, including '{path}'. Review it or use force cleanup."),
            RetryClass::AfterUserAction,
        ),
        HiveoryGitError::WorktreeLocked => application_error(
            "git_worktree_locked",
            "The worktree is still locked by its worker lease.",
            RetryClass::AfterUserAction,
        ),
        HiveoryGitError::WorktreeBusy { path, detail } => {
            let display_path = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("the managed workspace");
            let mut error = application_error(
                "git_worktree_busy",
                format!(
                    "The managed workspace '{display_path}' is still in use by another process. {detail}"
                ),
                RetryClass::AfterUserAction,
            );
            error.recovery_action = Some(
                "Close applications using this workspace, wait a moment, and select Retry."
                    .to_owned(),
            );
            error
        }
        HiveoryGitError::MissingHead => application_error(
            "git_missing_head",
            "The repository has no commit to use as an orchestration base.",
            RetryClass::AfterUserAction,
        ),
        HiveoryGitError::MergeConflict(paths) => application_error(
            "git_orchestration_conflict",
            format!("Git found conflicts that must be resolved: {paths}"),
            RetryClass::AfterUserAction,
        ),
        HiveoryGitError::InvalidInput(message) => {
            application_error("git_request_invalid", message, RetryClass::AfterUserAction)
        }
        HiveoryGitError::Command { operation, detail } => application_error(
            "git_command_failed",
            format!("Git {operation} failed: {detail}"),
            RetryClass::AfterUserAction,
        ),
        HiveoryGitError::NoStagedChanges => application_error(
            "git_nothing_to_commit",
            "There are no staged changes to commit.",
            RetryClass::AfterUserAction,
        ),
    }
}

fn hosted_error(error: hosted_source::HostedCommandError) -> ApiError {
    let (code, message, retry) = match error.auth_state() {
        hiveory_protocol::CodeHostedAuthState::MissingCli => (
            "hosted_cli_missing",
            error.message(),
            RetryClass::AfterUserAction,
        ),
        hiveory_protocol::CodeHostedAuthState::NotAuthenticated => (
            "hosted_auth_required",
            error.message(),
            RetryClass::AfterUserAction,
        ),
        hiveory_protocol::CodeHostedAuthState::NoRepository => (
            "hosted_repository_missing",
            error.message(),
            RetryClass::AfterUserAction,
        ),
        hiveory_protocol::CodeHostedAuthState::Offline => {
            ("hosted_offline", error.message(), RetryClass::Safe)
        }
        hiveory_protocol::CodeHostedAuthState::RateLimited => (
            "hosted_rate_limited",
            error.message(),
            RetryClass::AfterUserAction,
        ),
        _ => (
            "hosted_operation_failed",
            "The hosted source-control operation failed. Refresh and try again.",
            RetryClass::AfterUserAction,
        ),
    };
    application_error(code, message, retry)
}

fn orchestration_error(error: HiveoryCodeOrchestrationError) -> ApiError {
    match error {
        HiveoryCodeOrchestrationError::Database(_) => application_error(
            "code_orchestration_database_failed",
            "The durable Code run state could not be saved.",
            RetryClass::Safe,
        ),
        HiveoryCodeOrchestrationError::Workspace(error) => workspace_error(error),
        HiveoryCodeOrchestrationError::Git(error) => git_error(error),
        HiveoryCodeOrchestrationError::Domain(error) => validation_error(error.to_string()),
        HiveoryCodeOrchestrationError::Json(_) => application_error(
            "code_orchestration_invalid_data",
            "The orchestration payload was invalid.",
            RetryClass::AfterUserAction,
        ),
        HiveoryCodeOrchestrationError::Io(_) => application_error(
            "code_orchestration_io_failed",
            "The orchestration filesystem operation failed.",
            RetryClass::Safe,
        ),
        HiveoryCodeOrchestrationError::NotFound => application_error(
            "code_orchestration_not_found",
            "The requested Code run no longer exists.",
            RetryClass::AfterUserAction,
        ),
        HiveoryCodeOrchestrationError::InvalidState(message) => validation_error(message),
        HiveoryCodeOrchestrationError::WorkerUnavailable(_) => application_error(
            "code_worker_unavailable",
            "The configured coding agent is not available on this host.",
            RetryClass::AfterUserAction,
        ),
        HiveoryCodeOrchestrationError::WorkerFailed(_) => application_error(
            "code_worker_failed",
            "The coding-agent worker failed. Inspect the run and retry the task if appropriate.",
            RetryClass::AfterUserAction,
        ),
        HiveoryCodeOrchestrationError::InvalidWorkerEvent => application_error(
            "code_worker_event_rejected",
            "A worker event failed the orchestration authenticity check.",
            RetryClass::AfterUserAction,
        ),
        HiveoryCodeOrchestrationError::InvalidCleanupConfirmation => {
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
    stored: &HiveoryStoredAttachment,
    artifacts: &HiveoryArtifactStore,
) -> String {
    stored
        .absolute_path
        .strip_prefix(artifacts.root())
        .unwrap_or(&stored.absolute_path)
        .to_string_lossy()
        .replace('\\', "/")
}
fn provider_error_code(error: &HiveoryProviderError) -> &'static str {
    match error {
        HiveoryProviderError::CredentialsUnavailable => "provider_not_configured",
        HiveoryProviderError::Request(_) => "provider_request_failed",
        HiveoryProviderError::InvalidResponse => "provider_invalid_response",
        HiveoryProviderError::Cancelled => "cancelled",
    }
}
fn artifact_error(error: HiveoryArtifactError) -> ApiError {
    let (code, message) = match error {
        HiveoryArtifactError::NotAFile => ("attachment_not_a_file", "Choose a regular file."),
        HiveoryArtifactError::UnsupportedType => (
            "attachment_type_denied",
            "Only PDF, PNG, JPEG, WebP, text, and Markdown files are supported.",
        ),
        HiveoryArtifactError::TooLarge => (
            "attachment_too_large",
            "The attachment exceeds the Chat size limit.",
        ),
        HiveoryArtifactError::InvalidText => (
            "attachment_invalid_text",
            "Text attachments must be valid UTF-8 without binary data.",
        ),
        HiveoryArtifactError::InvalidContent => (
            "attachment_invalid_content",
            "The file content does not match its detected type.",
        ),
        HiveoryArtifactError::Storage => (
            "attachment_storage_failed",
            "The attachment could not be stored safely.",
        ),
        HiveoryArtifactError::Export => (
            "export_failed",
            "The conversation export could not be written.",
        ),
    };
    application_error(code, message, RetryClass::AfterUserAction)
}
fn chat_error(error: HiveoryChatStoreError) -> ApiError {
    match error {
        HiveoryChatStoreError::NotFound => application_error(
            "chat_not_found",
            "The conversation or message no longer exists.",
            RetryClass::AfterUserAction,
        ),
        HiveoryChatStoreError::ActiveTurn => application_error(
            "turn_active",
            "Stop the active response before starting another one.",
            RetryClass::AfterUserAction,
        ),
        HiveoryChatStoreError::InvalidInput(message) => {
            application_error("chat_invalid_input", message, RetryClass::AfterUserAction)
        }
        HiveoryChatStoreError::Inconsistent => application_error(
            "chat_inconsistent",
            "Stored conversation data is inconsistent.",
            RetryClass::Safe,
        ),
        HiveoryChatStoreError::Database(error) => database_error(error),
        HiveoryChatStoreError::Serialization(_) => application_error(
            "chat_serialization_failed",
            "Conversation data could not be serialized.",
            RetryClass::Safe,
        ),
    }
}

fn routine_scheduler_error(error: HiveoryRoutineSchedulerError) -> ApiError {
    match error {
        HiveoryRoutineSchedulerError::InvalidSchedule(message) => validation_error(message),
        HiveoryRoutineSchedulerError::Launcher(message) => application_error(
            "routine_launcher_failed",
            message,
            RetryClass::AfterUserAction,
        ),
        HiveoryRoutineSchedulerError::Store(error) => match error {
            hiveory_persistence::routine::HiveoryRoutineStoreError::InvalidInput(message) => {
                validation_error(message)
            }
            hiveory_persistence::routine::HiveoryRoutineStoreError::NotFound => application_error(
                "routine_not_found",
                "The routine is no longer available.",
                RetryClass::AfterUserAction,
            ),
            hiveory_persistence::routine::HiveoryRoutineStoreError::Conflict => application_error(
                "routine_conflict",
                "The routine changed or conflicts with existing state.",
                RetryClass::AfterUserAction,
            ),
            hiveory_persistence::routine::HiveoryRoutineStoreError::Database(error) => {
                database_error(error)
            }
            hiveory_persistence::routine::HiveoryRoutineStoreError::Serialization(_) => {
                application_error(
                    "routine_serialization_failed",
                    "The routine data could not be encoded.",
                    RetryClass::Safe,
                )
            }
        },
    }
}

fn plugin_runtime_error(error: HiveoryPluginRuntimeError) -> ApiError {
    match error {
        HiveoryPluginRuntimeError::InvalidInput(message) => validation_error(message),
        HiveoryPluginRuntimeError::NotFound(item) => application_error(
            "plugin_not_found",
            format!("The plugin resource '{item}' is no longer available."),
            RetryClass::AfterUserAction,
        ),
        HiveoryPluginRuntimeError::Secret(_) => application_error(
            "secret_store_unavailable",
            "The operating system credential store is unavailable.",
            RetryClass::AfterUserAction,
        ),
        HiveoryPluginRuntimeError::Request(_) => application_error(
            "plugin_request_failed",
            "The plugin request failed. Check the connection and try again.",
            RetryClass::AfterUserAction,
        ),
        HiveoryPluginRuntimeError::InvalidResponse => application_error(
            "plugin_invalid_response",
            "The plugin returned an invalid or oversized JSON response.",
            RetryClass::AfterUserAction,
        ),
        HiveoryPluginRuntimeError::Serialization(_) => application_error(
            "plugin_serialization_failed",
            "The plugin data could not be encoded.",
            RetryClass::Safe,
        ),
        HiveoryPluginRuntimeError::Store(error) => match error {
            hiveory_persistence::plugin::HiveoryPluginStoreError::InvalidInput(message) => {
                validation_error(message)
            }
            hiveory_persistence::plugin::HiveoryPluginStoreError::NotFound => application_error(
                "plugin_not_found",
                "The plugin resource is no longer available.",
                RetryClass::AfterUserAction,
            ),
            hiveory_persistence::plugin::HiveoryPluginStoreError::Conflict => application_error(
                "plugin_conflict",
                "The plugin connection or grant conflicts with existing state.",
                RetryClass::AfterUserAction,
            ),
            hiveory_persistence::plugin::HiveoryPluginStoreError::Database(error) => {
                database_error(error)
            }
            hiveory_persistence::plugin::HiveoryPluginStoreError::Serialization(_) => {
                application_error(
                    "plugin_serialization_failed",
                    "The plugin data could not be encoded.",
                    RetryClass::Safe,
                )
            }
        },
        HiveoryPluginRuntimeError::RoutineStore(_) => application_error(
            "persistence_unavailable",
            "Routine execution state is unavailable.",
            RetryClass::Safe,
        ),
    }
}

#[tauri::command]
async fn hiveory_command_configure_openai_provider(
    model: String,
    foundation: State<'_, HiveoryFoundation>,
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
            Some(HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID),
            Some("model updated"),
        )
        .await
        .map_err(database_error)
}
#[tauri::command]
async fn hiveory_command_set_openai_secret(
    secret: String,
    foundation: State<'_, HiveoryFoundation>,
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
            Some(HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID),
            Some("secret handle updated"),
        )
        .await
        .map_err(database_error)
}
#[tauri::command]
async fn hiveory_command_validate_openai_provider(
    foundation: State<'_, HiveoryFoundation>,
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
            Some(HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID),
            None,
        )
        .await
        .map_err(database_error)
}
#[tauri::command]
async fn hiveory_command_start_provider_diagnostic(
    request: ProviderDiagnosticRequest,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<String, ApiError> {
    if request.provider_account_id != HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID {
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
            Err(HiveoryProviderError::Cancelled) => {
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
async fn hiveory_command_cancel_job(
    job_id: String,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<bool, ApiError> {
    Ok(foundation.jobs.cancel(&job_id))
}
#[tauri::command]
fn hiveory_stream_shared_events(
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_send_test_notification(
    app: tauri::AppHandle,
    foundation: State<'_, HiveoryFoundation>,
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
async fn hiveory_command_mark_notification_read(
    notification_id: String,
    foundation: State<'_, HiveoryFoundation>,
) -> Result<bool, ApiError> {
    foundation
        .persistence
        .mark_notification_read(notification_id.trim())
        .await
        .map_err(database_error)
}

#[tauri::command]
async fn hiveory_command_mark_all_notifications_read(
    foundation: State<'_, HiveoryFoundation>,
) -> Result<u64, ApiError> {
    foundation
        .persistence
        .mark_all_notifications_read()
        .await
        .map_err(database_error)
}

fn start_native_notification_bridge(app: tauri::AppHandle, jobs: HiveoryJobRuntime) {
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
    let open = MenuItem::with_id(app, "open", "Open Hiveory", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../../icons/32x32.png"
        ))?)
        .menu(&menu)
        .tooltip("Hiveory")
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
async fn hiveory_command_prepare_restart_recovery(
    app: tauri::AppHandle,
    foundation: State<'_, HiveoryFoundation>,
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
            std::fs::create_dir_all(&app_data_dir).map_err(Box::<dyn std::error::Error>::from)?;
            let database_path = app_data_dir.join("hiveory.sqlite3");
            let artifact_root = app_data_dir.join("artifacts");
            let orchestration_root = app_data_dir.join("orchestration");
            release::apply_pending_restore(&app_data_dir, &database_path, &artifact_root)
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            let foundation = tauri::async_runtime::block_on(HiveoryFoundation::open(
                database_path,
                artifact_root,
                orchestration_root,
            ))
            .map_err(Box::<dyn std::error::Error>::from)?;
            let browser_configuration = tauri::async_runtime::block_on(
                browser::load_browser_configuration(&foundation.persistence),
            )
            .unwrap_or_default();
            let browser_manager = BrowserManager::new(
                app_data_dir.join("browser-profile"),
                app_data_dir.join("browser-profiles"),
                app.path()
                    .download_dir()
                    .unwrap_or_else(|_| app_data_dir.join("downloads")),
                foundation.persistence.clone(),
                browser_configuration,
            );
            foundation
                .agent_runtime
                .set_external_tool_provider(Arc::new(HiveoryExternalTools {
                    plugin: foundation.plugin_runtime.clone(),
                    browser: HiveoryBrowserToolProvider {
                        app: app.handle().clone(),
                        manager: browser_manager.clone(),
                        persistence: foundation.persistence.clone(),
                        code_workspaces: foundation.code_workspaces.clone(),
                        default_workspace_id: None,
                    },
                    computer: HiveoryComputerUseToolProvider {
                        persistence: foundation.persistence.clone(),
                    },
                }));
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
                .and_then(|value| serde_json::from_str::<HiveoryWindowState>(&value).ok());
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
            app.manage(HiveoryShellState {
                active_mode: RwLock::new(active_mode),
            });
            app.manage(HiveoryUpdateState::default());
            let routine_scheduler = foundation.routine_scheduler.clone();
            tauri::async_runtime::spawn(async move {
                routine_scheduler.run().await;
            });
            start_native_notification_bridge(app.handle().clone(), foundation.jobs.clone());
            app.manage(browser_manager);
            app.manage(foundation);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // The scheduler is local to this process. Closing the main
                // window therefore hides it to the tray; the explicit tray
                // Quit command remains the user's way to stop automations.
                api.prevent_close();
                if let Some(browser) = window.app_handle().try_state::<BrowserManager>() {
                    browser.close_all();
                }
                if let Some(foundation) = window.app_handle().try_state::<HiveoryFoundation>() {
                    if let (Ok(position), Ok(size), Ok(maximized)) = (
                        window.outer_position(),
                        window.outer_size(),
                        window.is_maximized(),
                    ) {
                        if let Ok(value) = serde_json::to_string(&HiveoryWindowState {
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
                }
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            hiveory_command_browser_open,
            hiveory_command_browser_navigate,
            hiveory_command_browser_back,
            hiveory_command_browser_forward,
            hiveory_command_browser_reload,
            hiveory_command_browser_set_bounds,
            hiveory_command_browser_focus,
            hiveory_command_browser_close,
            hiveory_query_browser_configuration,
            hiveory_command_browser_create_profile,
            hiveory_command_browser_delete_profile,
            hiveory_command_browser_update_settings,
            hiveory_command_browser_switch_profile,
            hiveory_command_browser_start_capture,
            hiveory_command_browser_copy_text,
            hiveory_command_clipboard_read_text,
            hiveory_command_browser_cancel_capture,
            hiveory_command_browser_sync_annotations,
            hiveory_command_browser_capture_frame,
            hiveory_command_browser_set_viewport,
            hiveory_command_browser_set_touch_emulation,
            hiveory_command_browser_open_devtools,
            hiveory_command_browser_open_external,
            hiveory_command_open_external_url,
            hiveory_query_browser_use_settings,
            hiveory_command_update_browser_use_settings,
            hiveory_command_browser_import_cookie_file,
            hiveory_command_browser_import_cookie_source,
            hiveory_query_bootstrap,
            hiveory_command_set_active_mode,
            hiveory_query_build_information,
            hiveory_query_diagnostic_snapshot,
            hiveory_query_update,
            hiveory_command_install_update,
            hiveory_command_create_backup,
            hiveory_command_prepare_restore,
            hiveory_query_agent_dashboard,
            hiveory_query_agents,
            hiveory_query_agent,
            hiveory_command_create_agent,
            hiveory_command_update_agent,
            hiveory_command_archive_agent,
            hiveory_command_delete_agent,
            hiveory_command_add_agent_folder,
            hiveory_command_delete_agent_folder,
            hiveory_query_agent_skills,
            hiveory_command_import_agent_skill,
            hiveory_command_create_agent_skill,
            hiveory_command_toggle_agent_skill,
            hiveory_command_resolve_agent_skill_conflict,
            hiveory_query_agent_memory,
            hiveory_command_remember_agent_memory,
            hiveory_command_delete_agent_memory,
            hiveory_query_agent_conversations,
            hiveory_query_agent_conversation,
            hiveory_command_create_agent_conversation,
            hiveory_query_agent_runs,
            hiveory_query_agent_run,
            hiveory_query_agent_events,
            hiveory_stream_agent_events,
            hiveory_command_start_agent_run,
            hiveory_command_resume_agent_run,
            hiveory_command_cancel_agent_run,
            hiveory_command_decide_agent_approval,
            hiveory_command_submit_agent_input,
            hiveory_command_export_agent,
            hiveory_query_routines,
            hiveory_query_routine,
            hiveory_command_create_routine,
            hiveory_command_update_routine,
            hiveory_command_archive_routine,
            hiveory_command_run_routine_now,
            hiveory_query_routine_executions,
            hiveory_query_plugin_catalog,
            hiveory_command_import_plugin_manifest,
            hiveory_command_register_plugin_manifest,
            hiveory_query_plugin_connections,
            hiveory_command_install_plugin,
            hiveory_command_create_plugin_connection,
            hiveory_command_update_plugin_connection,
            hiveory_command_delete_plugin_connection,
            hiveory_command_test_plugin_connection,
            hiveory_query_agent_plugin_grants,
            hiveory_command_set_agent_plugin_grant,
            hiveory_command_dry_run_plugin,
            hiveory_query_plugin_invocations,
            hiveory_query_code_snapshot,
            hiveory_query_code_workspace_context,
            hiveory_query_task_board_preferences,
            hiveory_query_code_workspace,
            hiveory_query_code_runs,
            hiveory_query_code_run,
            hiveory_query_code_mailbox,
            hiveory_command_send_code_mailbox,
            hiveory_command_ack_code_mailbox,
            hiveory_query_code_gates,
            hiveory_command_create_code_gate,
            hiveory_command_resolve_code_gate,
            hiveory_query_code_orchestration_events,
            hiveory_stream_code_orchestration_events,
            hiveory_command_add_code_project,
            hiveory_command_open_code_workspace,
            hiveory_command_create_code_workspace,
            hiveory_command_update_code_workspace,
            hiveory_command_set_code_workspace_parent,
            hiveory_command_open_code_workspace_in,
            hiveory_command_set_code_workspace_context,
            hiveory_command_update_task_board_preferences,
            hiveory_command_remove_code_workspace,
            hiveory_command_remove_code_project,
            hiveory_command_trust_code_workspace,
            hiveory_command_create_code_run,
            hiveory_command_update_code_run,
            hiveory_command_create_code_task,
            hiveory_command_update_code_task,
            hiveory_command_delete_code_task,
            hiveory_command_propose_code_dag,
            hiveory_command_accept_code_dag,
            hiveory_command_start_code_run,
            hiveory_command_pause_code_run,
            hiveory_command_cancel_code_run,
            hiveory_command_resume_code_dispatch,
            hiveory_command_cancel_code_dispatch,
            hiveory_command_open_code_dispatch_terminal,
            hiveory_command_answer_code_question,
            hiveory_command_retry_code_task,
            hiveory_command_review_code_checkpoint,
            hiveory_query_code_cleanup_preview,
            hiveory_query_code_checkpoint_diff,
            hiveory_command_confirm_code_cleanup,
            hiveory_query_code_file_tree,
            hiveory_query_code_file,
            hiveory_command_save_code_file,
            hiveory_command_create_code_file,
            hiveory_command_import_code_asset,
            hiveory_query_code_asset,
            hiveory_command_rename_code_file,
            hiveory_command_save_code_layout,
            hiveory_query_code_layout_presets,
            hiveory_command_create_code_layout_preset,
            hiveory_command_update_code_layout_preset,
            hiveory_command_open_code_layout_preset,
            hiveory_query_code_launch_presets,
            hiveory_command_create_code_launch_preset,
            hiveory_command_update_code_launch_preset,
            hiveory_command_open_code_launch_preset,
            hiveory_command_apply_code_pane_mutation,
            hiveory_command_launch_code_pane_terminal,
            hiveory_command_open_code_pane_preview,
            hiveory_command_open_code_pane_markdown,
            hiveory_command_create_code_pane_markdown,
            hiveory_command_close_code_pane,
            hiveory_query_code_terminal_snapshot,
            hiveory_stream_code_terminal_events,
            hiveory_query_code_terminal_history,
            hiveory_query_code_git_status,
            hiveory_query_code_git_diff,
            hiveory_query_code_git_repository,
            hiveory_query_code_hosted_tracking,
            hiveory_query_task_sources,
            hiveory_command_connect_task_source,
            hiveory_command_remove_task_source,
            hiveory_command_stage_code_git,
            hiveory_command_discard_code_git,
            hiveory_command_commit_code_git,
            hiveory_command_create_code_git_branch,
            hiveory_command_checkout_code_git_branch,
            hiveory_command_delete_code_git_branch,
            hiveory_command_fetch_code_git,
            hiveory_command_pull_code_git,
            hiveory_command_push_code_git,
            hiveory_command_save_code_git_stash,
            hiveory_command_pop_code_git_stash,
            hiveory_command_drop_code_git_stash,
            hiveory_command_create_code_hosted_issue,
            hiveory_command_update_code_hosted_issue,
            hiveory_command_action_code_hosted_issue,
            hiveory_command_create_code_hosted_pull_request,
            hiveory_command_action_code_hosted_pull_request,
            hiveory_command_start_code_terminal,
            hiveory_command_write_code_terminal,
            hiveory_command_resize_code_terminal,
            hiveory_command_stop_code_terminal,
            hiveory_command_set_code_terminal_history,
            hiveory_command_open_code_preview,
            hiveory_query_chat_sidebar,
            hiveory_query_chat_engines,
            hiveory_query_chat_conversation,
            hiveory_query_chat_events,
            hiveory_command_create_chat,
            hiveory_command_update_chat,
            hiveory_command_delete_chat,
            hiveory_command_create_chat_folder,
            hiveory_command_update_chat_folder,
            hiveory_command_delete_chat_folder,
            hiveory_command_move_chat_to_folder,
            hiveory_command_save_chat_draft,
            hiveory_command_import_chat_attachments,
            hiveory_command_import_chat_attachment_bytes,
            hiveory_command_delete_chat_attachment,
            hiveory_command_discard_chat_attachment,
            hiveory_command_start_chat_turn,
            hiveory_command_cancel_chat_turn,
            hiveory_command_retry_chat_turn,
            hiveory_command_edit_chat_message,
            hiveory_command_branch_chat,
            hiveory_command_export_chat,
            hiveory_stream_chat_events,
            hiveory_command_configure_openai_provider,
            hiveory_command_set_openai_secret,
            hiveory_command_validate_openai_provider,
            hiveory_command_start_provider_diagnostic,
            hiveory_command_cancel_job,
            hiveory_stream_shared_events,
            hiveory_command_send_test_notification,
            hiveory_command_mark_notification_read,
            hiveory_command_mark_all_notifications_read,
            hiveory_command_prepare_restart_recovery
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hiveory");
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

fn validate_workspace_display_name(value: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 || value.chars().any(char::is_control) {
        return Err(validation_error(
            "Workspace names must be 1-80 non-control characters.",
        ));
    }
    Ok(value.to_owned())
}

fn validate_branch_name(value: &str) -> Result<(), ApiError> {
    if value.is_empty()
        || value.len() > 240
        || value.chars().any(char::is_control)
        || value.contains("..")
        || value.contains(' ')
        || value.ends_with('.')
        || value.ends_with('/')
        || value.starts_with('/')
    {
        return Err(validation_error(
            "Branch names must be valid Git references without spaces or traversal segments.",
        ));
    }
    Ok(())
}

fn workspace_slug(value: &str) -> String {
    let mut slug = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "workspace".to_owned()
    } else {
        slug.chars().take(48).collect()
    }
}

fn database_error(error: sqlx::Error) -> ApiError {
    application_error(
        "persistence_unavailable",
        error.to_string(),
        RetryClass::Safe,
    )
}
fn secret_error(_: hiveory_secret_store::HiveorySecretStoreError) -> ApiError {
    application_error(
        "secret_store_unavailable",
        "The operating system credential store is unavailable.",
        RetryClass::AfterUserAction,
    )
}
fn agent_runtime_error(error: hiveory_agent_runtime::HiveoryAgentRuntimeError) -> ApiError {
    match error {
        hiveory_agent_runtime::HiveoryAgentRuntimeError::InvalidInput(message) => {
            validation_error(message)
        }
        hiveory_agent_runtime::HiveoryAgentRuntimeError::Provider(_) => application_error(
            "agent_provider_failed",
            "The Agent provider request failed. Check the provider account and try again.",
            RetryClass::AfterUserAction,
        ),
        hiveory_agent_runtime::HiveoryAgentRuntimeError::Cancelled => application_error(
            "agent_cancelled",
            "The Agent run was cancelled.",
            RetryClass::Safe,
        ),
        hiveory_agent_runtime::HiveoryAgentRuntimeError::Artifact(_) => application_error(
            "artifact_unavailable",
            "The Agent artifact could not be stored.",
            RetryClass::Safe,
        ),
        hiveory_agent_runtime::HiveoryAgentRuntimeError::Store(error) => application_error(
            "persistence_unavailable",
            error.to_string(),
            RetryClass::Safe,
        ),
    }
}
fn provider_error(_: HiveoryProviderError) -> ApiError {
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

fn release_error(error: release::HiveoryReleaseError) -> ApiError {
    application_error(
        "release_operation_failed",
        error.to_string(),
        RetryClass::Safe,
    )
}

#[cfg(test)]
mod cli_orchestration_tests {
    use super::*;

    #[test]
    fn cli_sessions_expose_visible_worker_and_mailbox_tools() {
        let names = cli_session_management_definitions()
            .into_iter()
            .map(|tool| tool.name)
            .collect::<HashSet<_>>();
        for expected in [
            "session.status",
            "session.capabilities",
            "session.current_context",
            "orchestration.adapter_catalog",
            "orchestration.list_workers",
            "orchestration.open_worker_pane",
            "orchestration.assign_task",
            "orchestration.report_completion",
            "orchestration.list_participants",
            "orchestration.inbox",
            "orchestration.acknowledge_message",
            "orchestration.wait",
            "agent_panes.list",
            "agent_panes.open",
            "agent_panes.rename",
        ] {
            assert!(
                names.contains(expected),
                "missing CLI control tool: {expected}"
            );
        }
    }
}
