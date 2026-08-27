import { Channel, invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

export type ApplicationMode = 'agent' | 'code' | 'chat'
export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type ChatReasoningEffort = 'auto' | 'low' | 'medium' | 'high'
export type ChatTurnState = 'queued' | 'streaming' | 'cancel_requested' | 'cancelled' | 'completed' | 'failed' | 'interrupted'
export type ProviderAccountSummary = { id: string; display_name: string; default_model: string | null; secret_configured: boolean; enabled: boolean }
export type JobSummary = { id: string; kind: string; state: JobState; created_at_unix_ms: number; updated_at_unix_ms: number; error_code: string | null }
export type NotificationSummary = { id: string; title: string; body: string; severity: string; read: boolean; created_at_unix_ms: number }
export type SharedEventEnvelope = { sequence: number; kind: string; job_id: string | null; message: string | null; text_delta: string | null }
export type DiagnosticSnapshot = { providers: ProviderAccountSummary[]; recent_jobs: JobSummary[]; notifications: NotificationSummary[]; recovery_message: string | null }
export type BootstrapSnapshot = { protocol: { major: number }; active_mode: ApplicationMode; product_name: string }

export type CodeWorkspaceTrust = 'untrusted' | 'trusted'
export type CodeWorkspaceCapability = 'read_files' | 'write_files' | 'execute_processes' | 'read_git' | 'open_preview'
export type CodeWorkspaceSummary = { id: string; host_id: string; display_name: string; root_path: string; repository_name: string | null; branch: string | null; is_git_repository: boolean; trust: CodeWorkspaceTrust; capabilities: CodeWorkspaceCapability[]; updated_at_unix_ms: number }
export type CodeWorkspaceDetail = { summary: CodeWorkspaceSummary; layout: CodePaneLayout; open_documents: CodeDocumentSummary[]; terminals: CodeTerminalSummary[]; previews: CodePreviewSummary[] }
export type CodeSnapshot = { workspaces: CodeWorkspaceSummary[]; active_workspace_id: string | null; adapters: CodeAdapterSummary[] }
export type CodeFileKind = 'file' | 'directory' | 'symlink' | 'binary'
export type CodeFileNode = { name: string; relative_path: string; kind: CodeFileKind; size: number | null; language: string | null; modified_at_unix_ms: number | null }
export type CodeFileTree = { workspace_id: string; directory: string; entries: CodeFileNode[]; truncated: boolean }
export type CodeDocumentSummary = { relative_path: string; language: string | null; last_fingerprint: string | null; last_opened_at_unix_ms: number }
export type CodeDocument = { workspace_id: string; relative_path: string; content: string; language: string | null; fingerprint: string; bytes: number; read_only: boolean; binary: boolean }
export type CodePaneKind = 'terminal' | 'coding_agent' | 'editor' | 'diff' | 'preview' | 'problems' | 'empty'
export type CodePaneOrientation = 'horizontal' | 'vertical'
export type CodePaneNode = { pane_id: string; parent_id: string | null; kind: CodePaneKind; orientation: CodePaneOrientation | null; ratio_percent: number | null; children: string[]; resource_id: string | null }
export type CodePaneLayout = { workspace_id: string; version: number; root_id: string; nodes: CodePaneNode[] }
export type CodeTerminalKind = 'shell' | 'coding_agent'
export type CodeTerminalState = 'starting' | 'running' | 'exited' | 'failed' | 'interrupted'
export type CodeTerminalSummary = { id: string; workspace_id: string; kind: CodeTerminalKind; state: CodeTerminalState; pid: number | null; adapter_id: string | null; session_id: string | null; exit_code: number | null; started_at_unix_ms: number; updated_at_unix_ms: number }
export type CodeTerminalEventKind = 'started' | 'output' | 'exited' | 'error'
export type CodeTerminalEvent = { terminal_id: string; kind: CodeTerminalEventKind; data_base64: string | null; exit_code: number | null; message: string | null; emitted_at_unix_ms: number }
export type CodeAdapterCapability = 'resume' | 'model_selection' | 'reasoning_effort' | 'permission_modes'
export type CodeAdapterSummary = { id: string; display_name: string; executable: string; detected: boolean; authenticated: boolean; capabilities: CodeAdapterCapability[] }
export type CodeGitFileStatus = { relative_path: string; status: string; staged: boolean; conflict: boolean }
export type CodeGitStatus = { workspace_id: string; branch: string | null; ahead: number; behind: number; files: CodeGitFileStatus[] }
export type CodeGitDiff = { workspace_id: string; relative_path: string | null; content: string; binary: boolean; truncated: boolean }
export type CodePreviewState = 'open' | 'closed' | 'blocked'
export type CodePreviewSummary = { id: string; workspace_id: string; url: string; origin: string; state: CodePreviewState }
export type CodeRunState = 'draft' | 'ready' | 'running' | 'paused' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type CodeTaskState = 'draft' | 'blocked' | 'ready' | 'preparing' | 'running' | 'awaiting_input' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled'
export type CodeDispatchState = 'preparing' | 'running' | 'awaiting_input' | 'checkpointing' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'stale'
export type CodeReviewPolicy = 'manual' | 'automatic'
export type CodeReviewDecision = 'accept' | 'request_changes' | 'reject'
export type CodeCheckpointKind = 'source' | 'result' | 'integration'
export type CodeCheckpointState = 'creating' | 'ready' | 'failed'
export type CodeManagedWorktreeState = 'provisioning' | 'ready' | 'cleanup_pending' | 'removed' | 'failed'
export type CodeOrchestrationMessageKind = 'status' | 'heartbeat' | 'question' | 'answer' | 'escalation' | 'progress' | 'completion'
export type CodeRunSummary = { id: string; workspace_id: string; title: string; objective: string; model: string | null; state: CodeRunState; review_policy: CodeReviewPolicy; concurrency_limit: number; host_concurrency_cap: number; task_count: number; completed_tasks: number; active_dispatches: number; created_at_unix_ms: number; updated_at_unix_ms: number; error: string | null }
export type CodeTask = { id: string; run_id: string; client_id: string; title: string; specification: string; state: CodeTaskState; position: number; active_dispatch_id: string | null; latest_checkpoint_id: string | null; base_checkpoint_id: string | null; attempt: number; error: string | null; created_at_unix_ms: number; updated_at_unix_ms: number }
export type CodeTaskDependency = { run_id: string; task_id: string; depends_on_task_id: string }
export type CodeDispatch = { id: string; run_id: string; task_id: string; attempt: number; state: CodeDispatchState; lease_generation: number; session_id: string | null; pid: number | null; worktree_id: string | null; checkpoint_id: string | null; last_heartbeat_at_unix_ms: number | null; started_at_unix_ms: number; updated_at_unix_ms: number; error: string | null; result_summary: string | null }
export type CodeManagedWorktree = { id: string; run_id: string; task_id: string; dispatch_id: string; path: string; branch: string; base_checkpoint_id: string | null; state: CodeManagedWorktreeState; dirty: boolean; locked: boolean; error: string | null; created_at_unix_ms: number; updated_at_unix_ms: number }
export type CodeCheckpoint = { id: string; run_id: string; task_id: string | null; dispatch_id: string | null; kind: CodeCheckpointKind; state: CodeCheckpointState; ref_name: string; commit_oid: string | null; parent_checkpoint_id: string | null; summary: string; created_at_unix_ms: number }
export type CodeReview = { id: string; run_id: string; task_id: string; checkpoint_id: string; decision: CodeReviewDecision; feedback: string | null; created_at_unix_ms: number }
export type CodeQuestion = { id: string; run_id: string; task_id: string; dispatch_id: string; prompt: string; answer: string | null; answered: boolean; created_at_unix_ms: number }
export type CodeOrchestrationMessage = { id: string; run_id: string; task_id: string | null; dispatch_id: string | null; kind: CodeOrchestrationMessageKind; question_id: string | null; payload: string; created_at_unix_ms: number }
export type CodeOrchestrationEventEnvelope = { run_id: string; sequence: number; event_id: string; task_id: string | null; dispatch_id: string | null; lease_generation: number; kind: CodeOrchestrationMessageKind; payload: string; accepted: boolean; emitted_at_unix_ms: number }
export type CodeDagProposalTask = { client_id: string; title: string; specification: string; depends_on: string[] }
export type CodeDagProposal = { objective: string; tasks: CodeDagProposalTask[]; warnings: string[] }
export type CodeRunDetail = { summary: CodeRunSummary; tasks: CodeTask[]; dependencies: CodeTaskDependency[]; dispatches: CodeDispatch[]; worktrees: CodeManagedWorktree[]; checkpoints: CodeCheckpoint[]; reviews: CodeReview[]; questions: CodeQuestion[]; messages: CodeOrchestrationMessage[]; events: CodeOrchestrationEventEnvelope[]; event_cursor: number; proposal: CodeDagProposal | null }

export type ChatAttachmentSummary = { id: string; display_name: string; mime_type: string; bytes: number; sha256: string }
export type ChatMessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning_summary'; text: string }
  | { kind: 'status'; code: string; text: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'attachment'; attachment: ChatAttachmentSummary }
  | { kind: 'image'; attachment: ChatAttachmentSummary }
  | { kind: 'citation'; url: string; title: string | null }
  | { kind: 'usage'; input_tokens: number | null; output_tokens: number | null }
  | { kind: 'tool_call'; call_id: string; name: string; arguments_json: string }
  | { kind: 'tool_result'; call_id: string; result: string }
export type ChatMessage = { id: string; branch_id: string; role: 'user' | 'assistant' | 'system'; parts: ChatMessagePart[]; created_at_unix_ms: number; turn_id: string | null }
export type ChatBranchSummary = { id: string; parent_branch_id: string | null; forked_after_message_id: string | null; label: string; created_at_unix_ms: number; active: boolean }
export type ChatTurnSummary = { id: string; message_id: string; assistant_message_id: string; branch_id: string; provider_account_id: string; model: string; reasoning_effort: ChatReasoningEffort; state: ChatTurnState; job_id: string | null; input_tokens: number | null; output_tokens: number | null; created_at_unix_ms: number; updated_at_unix_ms: number }
export type ChatConversationSummary = { id: string; title: string; active_branch_id: string; pinned: boolean; archived: boolean; updated_at_unix_ms: number; preview: string | null }
export type ChatConversationDetail = { id: string; title: string; active_branch_id: string; pinned: boolean; archived: boolean; branches: ChatBranchSummary[]; messages: ChatMessage[]; turns: ChatTurnSummary[]; draft: string; event_cursor: number; created_at_unix_ms: number; updated_at_unix_ms: number }
export type ChatSidebarPage = { conversations: ChatConversationSummary[]; next_cursor: string | null }
export type ChatEventEnvelope = { global_sequence: number; aggregate_sequence: number; conversation_id: string; branch_id: string | null; turn_id: string | null; message_id: string | null; kind: string; text_delta: string | null; message: string | null; emitted_at_unix_ms: number }

type ProtocolVersion = { major: number; minor?: number; patch?: number }
type CommandEnvelope<T> = { protocol: ProtocolVersion; request_id: string; payload: T }
type ResponseEnvelope<T> = { protocol: ProtocolVersion; request_id: string; payload: T }
type ChatCreateRequest = { title: string | null }
type ChatMetadataRequest = { conversation_id: string; title: string | null; pinned: boolean | null; archived: boolean | null }
type ChatDeleteRequest = { conversation_id: string }
type ChatDraftRequest = { conversation_id: string; draft: string }
type ChatAttachmentImportRequest = { conversation_id: string; message_id: string | null; paths: string[] }
export type ChatSendRequest = { conversation_id: string; branch_id: string; text: string; attachment_ids: string[]; provider_account_id: string; model: string; reasoning_effort: ChatReasoningEffort }
type ChatTurnRequest = { conversation_id: string; turn_id: string; model: string | null; reasoning_effort: ChatReasoningEffort | null }
type ChatEditRequest = { conversation_id: string; message_id: string; text: string; provider_account_id: string; model: string; reasoning_effort: ChatReasoningEffort }
type ChatBranchRequest = { conversation_id: string; message_id: string }
type ChatDeleteAttachmentRequest = { conversation_id: string; message_id: string; attachment_id: string }
type ChatExportRequest = { conversation_id: string; branch_id: string; destination: string }
type CodeWorkspaceOpenRequest = { path: string }
type CodeWorkspaceTrustRequest = { workspace_id: string; grant: boolean }
type CodeFileTreeQuery = { workspace_id: string; relative_path: string | null }
type CodeReadFileRequest = { workspace_id: string; relative_path: string }
type CodeSaveFileRequest = { workspace_id: string; relative_path: string; content: string; expected_fingerprint: string | null }
type CodeSaveLayoutRequest = { workspace_id: string; layout: CodePaneLayout }
type CodeGitStatusRequest = { workspace_id: string }
type CodeGitDiffRequest = { workspace_id: string; relative_path: string | null }
type CodeTerminalStartRequest = { workspace_id: string; kind: CodeTerminalKind; cols: number; rows: number; adapter_id: string | null; model: string | null; resume_session_id: string | null }
type CodeTerminalInputRequest = { terminal_id: string; data: string }
type CodeTerminalResizeRequest = { terminal_id: string; cols: number; rows: number }
type CodeTerminalStopRequest = { terminal_id: string; force: boolean }
type CodePreviewRequest = { workspace_id: string; url: string }
export type CodeRunCreateRequest = { workspace_id: string; title: string; objective: string; review_policy: CodeReviewPolicy; concurrency_limit: number | null; model: string | null }
export type CodeRunUpdateRequest = { run_id: string; title: string; objective: string; review_policy: CodeReviewPolicy; concurrency_limit: number | null }
export type CodeTaskCreateRequest = { run_id: string; client_id: string | null; title: string; specification: string; depends_on: string[] }
export type CodeTaskUpdateRequest = { run_id: string; task_id: string; title: string; specification: string; depends_on: string[] }
export type CodeTaskDeleteRequest = { run_id: string; task_id: string }
export type CodeDagProposalRequest = { workspace_id: string; objective: string; model: string | null }
export type CodeDagProposalAcceptRequest = { run_id: string; proposal: CodeDagProposal }
export type CodeRunRequest = { run_id: string }
export type CodeQuestionAnswerRequest = { run_id: string; task_id: string; dispatch_id: string; lease_generation: number; answer: string }
export type CodeTaskRetryRequest = { run_id: string; task_id: string; reason: string | null }
export type CodeReviewRequest = { run_id: string; task_id: string; checkpoint_id: string; decision: CodeReviewDecision; feedback: string | null }
export type CodeCleanupPreviewRequest = { run_id: string; worktree_id: string }
export type CodeCleanupPreview = { worktree_id: string; path: string; branch: string; dirty_files: string[]; locked: boolean; can_remove: boolean; reason: string | null }
export type CodeCleanupConfirmRequest = { run_id: string; worktree_id: string; confirmation: string; force: boolean }
export type CodeOrchestrationEventsQuery = { run_id: string; after_sequence: number; limit: number | null }
export type CodeCheckpointDiffRequest = { run_id: string; checkpoint_id: string; compare_to_checkpoint_id: string | null }

const protocol: ProtocolVersion = { major: 1, minor: 0, patch: 0 }
const agenticSuperAppIsTauri = '__TAURI_INTERNALS__' in window
const previewProvider: ProviderAccountSummary = { id: 'agentic-super-app-openai', display_name: 'OpenAI Responses', default_model: 'gpt-5.6-mini', secret_configured: false, enabled: true }
const previewConversations = new Map<string, ChatConversationDetail>()
const previewSubscribers = new Set<(event: ChatEventEnvelope) => void>()
const previewCodeWorkspaces = new Map<string, { detail: CodeWorkspaceDetail; files: Map<string, CodeDocument> }>()
const previewCodeRuns = new Map<string, CodeRunDetail>()
const previewCodeSubscribers = new Set<(event: CodeOrchestrationEventEnvelope) => void>()

function requestId() { return globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}-${Math.random().toString(16).slice(2)}` }
function previewId(prefix: string) { return `${prefix}-${requestId()}` }
function previewNow() { return Date.now() }
function envelope<T>(payload: T): CommandEnvelope<T> { return { protocol, request_id: requestId(), payload } }
function unwrap<T>(value: ResponseEnvelope<T>) { return value.payload }
function previewDetail(title = 'New chat'): ChatConversationDetail {
  const id = previewId('conversation')
  const branchId = previewId('branch')
  const now = previewNow()
  return { id, title, active_branch_id: branchId, pinned: false, archived: false, branches: [{ id: branchId, parent_branch_id: null, forked_after_message_id: null, label: 'Main', created_at_unix_ms: now, active: true }], messages: [], turns: [], draft: '', event_cursor: 0, created_at_unix_ms: now, updated_at_unix_ms: now }
}
function previewSummary(detail: ChatConversationDetail): ChatConversationSummary {
  const text = detail.messages.flatMap((message) => message.parts).find((part): part is Extract<ChatMessagePart, { kind: 'text' }> => part.kind === 'text')?.text ?? null
  return { id: detail.id, title: detail.title, active_branch_id: detail.active_branch_id, pinned: detail.pinned, archived: detail.archived, updated_at_unix_ms: detail.updated_at_unix_ms, preview: text?.slice(0, 160) ?? null }
}
function previewEvent(detail: ChatConversationDetail, kind: string, messageId: string | null, textDelta: string | null, message: string | null): ChatEventEnvelope {
  detail.event_cursor += 1
  const event = { global_sequence: detail.event_cursor, aggregate_sequence: detail.event_cursor, conversation_id: detail.id, branch_id: detail.active_branch_id, turn_id: null, message_id: messageId, kind, text_delta: textDelta, message, emitted_at_unix_ms: previewNow() }
  previewSubscribers.forEach((subscriber) => subscriber(event))
  return event
}
function previewResponse<T>(payload: T): Promise<T> { return Promise.resolve(payload) }
function previewCodeLayout(workspaceId: string): CodePaneLayout {
  return {
    workspace_id: workspaceId,
    version: 1,
    root_id: 'root',
    nodes: [
      { pane_id: 'root', parent_id: null, kind: 'empty', orientation: 'horizontal', ratio_percent: 24, children: ['editor', 'terminal'], resource_id: null },
      { pane_id: 'editor', parent_id: 'root', kind: 'editor', orientation: null, ratio_percent: null, children: [], resource_id: null },
      { pane_id: 'terminal', parent_id: 'root', kind: 'terminal', orientation: null, ratio_percent: null, children: [], resource_id: null },
    ],
  }
}
function previewCodeWorkspace(path: string): { detail: CodeWorkspaceDetail; files: Map<string, CodeDocument> } {
  const id = previewId('workspace')
  const now = previewNow()
  const files = new Map<string, CodeDocument>()
  const seed = (relativePath: string, content: string, language: string) => files.set(relativePath, { workspace_id: id, relative_path: relativePath, content, language, fingerprint: `preview-${relativePath}`, bytes: content.length, read_only: false, binary: false })
  seed('README.md', '# Agentic Super App\n\nThis is the Phase 4 browser preview workspace.\n', 'markdown')
  seed('src/main.tsx', "export function main() {\n  return 'Code mode is ready'\n}\n", 'typescript')
  const summary: CodeWorkspaceSummary = { id, host_id: 'browser-preview', display_name: path.split(/[\\/]/).filter(Boolean).pop() || 'Preview workspace', root_path: path || '~/agentic-demo', repository_name: 'agentic-demo', branch: 'main', is_git_repository: true, trust: 'untrusted', capabilities: ['read_files'], updated_at_unix_ms: now }
  const detail: CodeWorkspaceDetail = { summary, layout: previewCodeLayout(id), open_documents: [], terminals: [], previews: [] }
  const value = { detail, files }
  previewCodeWorkspaces.set(id, value)
  return value
}
function previewCodeDetail(workspaceId: string): CodeWorkspaceDetail {
  const workspace = previewCodeWorkspaces.get(workspaceId)
  if (!workspace) throw new Error('Workspace was not found.')
  return structuredClone(workspace.detail)
}
function previewCodeTree(workspaceId: string, relativeDirectory: string | null): CodeFileTree {
  const workspace = previewCodeWorkspaces.get(workspaceId)
  if (!workspace) throw new Error('Workspace was not found.')
  const directory = (relativeDirectory ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  const prefix = directory ? `${directory}/` : ''
  const entries = new Map<string, CodeFileNode>()
  workspace.files.forEach((file) => {
    if (!file.relative_path.startsWith(prefix)) return
    const remainder = file.relative_path.slice(prefix.length)
    const [name, ...rest] = remainder.split('/')
    if (!name) return
    if (rest.length) entries.set(name, { name, relative_path: `${prefix}${name}`, kind: 'directory', size: null, language: null, modified_at_unix_ms: null })
    else entries.set(name, { name, relative_path: file.relative_path, kind: 'file', size: file.bytes, language: file.language, modified_at_unix_ms: null })
  })
  return { workspace_id: workspaceId, directory, entries: [...entries.values()].sort((a, b) => (a.kind === 'directory' ? -1 : 1) - (b.kind === 'directory' ? -1 : 1) || a.name.localeCompare(b.name)), truncated: false }
}
function previewCodeSummary(): CodeSnapshot {
  return { workspaces: [...previewCodeWorkspaces.values()].map((item) => item.detail.summary), active_workspace_id: [...previewCodeWorkspaces.keys()][0] ?? null, adapters: [{ id: 'codex', display_name: 'Codex CLI', executable: 'codex', detected: false, authenticated: false, capabilities: ['resume', 'model_selection', 'reasoning_effort', 'permission_modes'] }] }
}
function previewCodeRunDetail(runId: string): CodeRunDetail {
  const detail = previewCodeRuns.get(runId)
  if (!detail) throw new Error('Run was not found.')
  return structuredClone(detail)
}
function previewCodeRunEvent(detail: CodeRunDetail, payload: string, taskId: string | null = null, dispatchId: string | null = null, kind: CodeOrchestrationMessageKind = 'status', accepted = true) {
  detail.event_cursor += 1
  const event: CodeOrchestrationEventEnvelope = { run_id: detail.summary.id, sequence: detail.event_cursor, event_id: previewId('event'), task_id: taskId, dispatch_id: dispatchId, lease_generation: 0, kind, payload, accepted, emitted_at_unix_ms: previewNow() }
  detail.events.push(event)
  detail.messages.unshift({ id: previewId('message'), run_id: detail.summary.id, task_id: taskId, dispatch_id: dispatchId, kind, question_id: null, payload, created_at_unix_ms: previewNow() })
  previewCodeSubscribers.forEach((subscriber) => subscriber(event))
}
function previewCodeRunSummary(workspaceId: string, title: string, objective: string): CodeRunSummary {
  const now = previewNow()
  return { id: previewId('run'), workspace_id: workspaceId, title, objective, model: null, state: 'draft', review_policy: 'manual', concurrency_limit: 2, host_concurrency_cap: 4, task_count: 0, completed_tasks: 0, active_dispatches: 0, created_at_unix_ms: now, updated_at_unix_ms: now, error: null }
}
function previewRecountRun(detail: CodeRunDetail) {
  detail.summary.task_count = detail.tasks.length
  detail.summary.completed_tasks = detail.tasks.filter((task) => task.state === 'completed').length
  detail.summary.active_dispatches = detail.dispatches.filter((dispatch) => ['preparing', 'running', 'awaiting_input', 'checkpointing'].includes(dispatch.state)).length
  detail.summary.updated_at_unix_ms = previewNow()
}
function previewAdvanceRun(runId: string) {
  const detail = previewCodeRuns.get(runId)
  if (!detail || detail.summary.state !== 'running') return
  const task = detail.tasks.find((candidate) => candidate.state === 'ready')
  if (!task) {
    if (detail.tasks.every((candidate) => candidate.state === 'completed')) detail.summary.state = 'completed'
    previewRecountRun(detail)
    return
  }
  task.state = 'running'
  const dispatch: CodeDispatch = { id: previewId('dispatch'), run_id: runId, task_id: task.id, attempt: task.attempt + 1, state: 'running', lease_generation: 1, session_id: null, pid: null, worktree_id: null, checkpoint_id: null, last_heartbeat_at_unix_ms: previewNow(), started_at_unix_ms: previewNow(), updated_at_unix_ms: previewNow(), error: null, result_summary: null }
  detail.dispatches.unshift(dispatch)
  detail.summary.active_dispatches += 1
  previewCodeRunEvent(detail, `Worker lane started: ${task.title}`, task.id, dispatch.id, 'progress')
  setTimeout(() => {
    const current = previewCodeRuns.get(runId)
    const currentTask = current?.tasks.find((candidate) => candidate.id === task.id)
    const currentDispatch = current?.dispatches.find((candidate) => candidate.id === dispatch.id)
    if (!current || !currentTask || !currentDispatch || current.summary.state !== 'running') return
    currentTask.state = current.summary.review_policy === 'manual' ? 'awaiting_review' : 'completed'
    currentDispatch.state = 'succeeded'
    currentDispatch.result_summary = 'Preview worker completed with a reviewable checkpoint.'
    currentDispatch.updated_at_unix_ms = previewNow()
    currentTask.latest_checkpoint_id = previewId('checkpoint')
    if (current.summary.review_policy === 'manual') current.summary.state = 'blocked'
    previewRecountRun(current)
    previewCodeRunEvent(current, current.summary.review_policy === 'manual' ? 'Checkpoint ready for review' : 'Worker completed', currentTask.id, currentDispatch.id, 'completion')
    if (current.summary.review_policy === 'automatic') setTimeout(() => previewAdvanceRun(runId), 250)
  }, 650)
  previewRecountRun(detail)
}

async function tauriCommand<TPayload, TResponse>(name: string, payload: TPayload): Promise<TResponse> {
  const result = await invoke<ResponseEnvelope<TResponse>>(name, { command: envelope(payload) })
  return unwrap(result)
}
async function tauriQuery<T>(name: string, args?: Record<string, unknown>): Promise<T> { return invoke<T>(name, args) }

export const agenticSuperAppClient = {
  async bootstrap(): Promise<BootstrapSnapshot> { return agenticSuperAppIsTauri ? tauriQuery<BootstrapSnapshot>('agentic_super_app_query_bootstrap') : { protocol, active_mode: 'agent', product_name: 'Agentic Super App' } },
  async setActiveMode(mode: ApplicationMode): Promise<BootstrapSnapshot> { return agenticSuperAppIsTauri ? invoke<BootstrapSnapshot>('agentic_super_app_command_set_active_mode', { command: { mode } }) : { protocol, active_mode: mode, product_name: 'Agentic Super App' } },
  async diagnostics(): Promise<DiagnosticSnapshot> { return agenticSuperAppIsTauri ? tauriQuery<DiagnosticSnapshot>('agentic_super_app_query_diagnostic_snapshot') : { providers: [previewProvider], recent_jobs: [], notifications: [], recovery_message: null } },
  async configureModel(model: string): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_configure_openai_provider', { model }) },
  async setSecret(secret: string): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_set_openai_secret', { secret }) },
  async validateProvider(): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_validate_openai_provider') },
  async startDiagnostic(request: { providerAccountId: string; model: string; prompt: string }): Promise<string> { return agenticSuperAppIsTauri ? invoke('agentic_super_app_command_start_provider_diagnostic', { request: { provider_account_id: request.providerAccountId, model: request.model, prompt: request.prompt } }) : 'preview-job' },
  async cancelJob(jobId: string): Promise<boolean> { return agenticSuperAppIsTauri ? invoke('agentic_super_app_command_cancel_job', { jobId }) : true },
  subscribe(onEvent: (event: SharedEventEnvelope) => void): void { if (agenticSuperAppIsTauri) void invoke('agentic_super_app_stream_shared_events', { channel: new Channel<SharedEventEnvelope>(onEvent) }) },
  async testNotification(): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_send_test_notification') },
  async restartRecovery(): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_prepare_restart_recovery') },

  async codeSnapshot(): Promise<CodeSnapshot> {
    return agenticSuperAppIsTauri ? tauriQuery<CodeSnapshot>('agentic_super_app_query_code_snapshot') : previewCodeSummary()
  },
  async codeWorkspace(workspaceId: string): Promise<CodeWorkspaceDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeWorkspaceDetail>('agentic_super_app_query_code_workspace', { query: { workspace_id: workspaceId } })
    return previewCodeDetail(workspaceId)
  },
  async openCodeWorkspace(path: string): Promise<CodeWorkspaceDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeWorkspaceOpenRequest, CodeWorkspaceDetail>('agentic_super_app_command_open_code_workspace', { path })
    return previewCodeWorkspace(path).detail
  },
  async trustCodeWorkspace(workspaceId: string, grant: boolean): Promise<CodeWorkspaceDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeWorkspaceTrustRequest, CodeWorkspaceDetail>('agentic_super_app_command_trust_code_workspace', { workspace_id: workspaceId, grant })
    const workspace = previewCodeWorkspaces.get(workspaceId)
    if (!workspace) throw new Error('Workspace was not found.')
    workspace.detail.summary.trust = grant ? 'trusted' : 'untrusted'
    workspace.detail.summary.capabilities = grant ? ['read_files', 'write_files', 'execute_processes', 'read_git', 'open_preview'] : ['read_files']
    return previewCodeDetail(workspaceId)
  },
  async codeFileTree(request: CodeFileTreeQuery): Promise<CodeFileTree> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeFileTree>('agentic_super_app_query_code_file_tree', { query: request })
    return previewCodeTree(request.workspace_id, request.relative_path)
  },
  async readCodeFile(request: CodeReadFileRequest): Promise<CodeDocument> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeDocument>('agentic_super_app_query_code_file', { request })
    const file = previewCodeWorkspaces.get(request.workspace_id)?.files.get(request.relative_path)
    if (!file) throw new Error('File was not found.')
    return structuredClone(file)
  },
  async saveCodeFile(request: CodeSaveFileRequest): Promise<CodeDocument> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeSaveFileRequest, CodeDocument>('agentic_super_app_command_save_code_file', request)
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    const file = workspace?.files.get(request.relative_path)
    if (!workspace || !file) throw new Error('File was not found.')
    if (workspace.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before saving files.')
    if (request.expected_fingerprint && request.expected_fingerprint !== file.fingerprint) throw new Error('The file changed on disk. Reload it before saving.')
    file.content = request.content
    file.bytes = request.content.length
    file.fingerprint = `preview-${previewNow()}-${Math.random().toString(16).slice(2)}`
    return structuredClone(file)
  },
  async saveCodeLayout(request: CodeSaveLayoutRequest): Promise<CodePaneLayout> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeSaveLayoutRequest, CodePaneLayout>('agentic_super_app_command_save_code_layout', request)
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (!workspace) throw new Error('Workspace was not found.')
    workspace.detail.layout = structuredClone(request.layout)
    return structuredClone(request.layout)
  },
  async codeGitStatus(request: CodeGitStatusRequest): Promise<CodeGitStatus> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeGitStatus>('agentic_super_app_query_code_git_status', { request })
    if (previewCodeWorkspaces.get(request.workspace_id)?.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before reading Git status.')
    return { workspace_id: request.workspace_id, branch: 'main', ahead: 0, behind: 0, files: [] }
  },
  async codeGitDiff(request: CodeGitDiffRequest): Promise<CodeGitDiff> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeGitDiff>('agentic_super_app_query_code_git_diff', { request })
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (!workspace) throw new Error('Workspace was not found.')
    if (workspace.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before reading Git diff.')
    const file = request.relative_path ? workspace.files.get(request.relative_path) : null
    return { workspace_id: request.workspace_id, relative_path: request.relative_path, content: file ? `diff --git a/${file.relative_path} b/${file.relative_path}\n--- a/${file.relative_path}\n+++ b/${file.relative_path}\n@@\n+${file.content}` : '', binary: false, truncated: false }
  },
  async startCodeTerminal(request: CodeTerminalStartRequest, onEvent: (event: CodeTerminalEvent) => void): Promise<CodeTerminalSummary> {
    if (agenticSuperAppIsTauri) {
      const channel = new Channel<CodeTerminalEvent>(onEvent)
      const result = await invoke<ResponseEnvelope<CodeTerminalSummary>>('agentic_super_app_command_start_code_terminal', { command: envelope(request), channel })
      return unwrap(result)
    }
    if (previewCodeWorkspaces.get(request.workspace_id)?.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before starting a terminal.')
    const id = previewId('terminal')
    const now = previewNow()
    const summary: CodeTerminalSummary = { id, workspace_id: request.workspace_id, kind: request.kind, state: 'running', pid: null, adapter_id: request.adapter_id, session_id: null, exit_code: null, started_at_unix_ms: now, updated_at_unix_ms: now }
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (workspace) workspace.detail.terminals = [summary, ...workspace.detail.terminals.filter((item) => item.id !== id)]
    onEvent({ terminal_id: id, kind: 'started', data_base64: null, exit_code: null, message: null, emitted_at_unix_ms: now })
    setTimeout(() => onEvent({ terminal_id: id, kind: 'output', data_base64: btoa('Phase 4 preview terminal ready.\r\n'), exit_code: null, message: null, emitted_at_unix_ms: previewNow() }), 20)
    return summary
  },
  async writeCodeTerminal(request: CodeTerminalInputRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<CodeTerminalInputRequest, boolean>('agentic_super_app_command_write_code_terminal', request) : true },
  async resizeCodeTerminal(request: CodeTerminalResizeRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<CodeTerminalResizeRequest, boolean>('agentic_super_app_command_resize_code_terminal', request) : true },
  async stopCodeTerminal(request: CodeTerminalStopRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<CodeTerminalStopRequest, boolean>('agentic_super_app_command_stop_code_terminal', request) : true },
  async openCodePreview(request: CodePreviewRequest): Promise<CodePreviewSummary> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodePreviewRequest, CodePreviewSummary>('agentic_super_app_command_open_code_preview', request)
    if (previewCodeWorkspaces.get(request.workspace_id)?.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before opening a preview.')
    const url = new URL(request.url)
    const preview: CodePreviewSummary = { id: previewId('preview'), workspace_id: request.workspace_id, url: url.toString(), origin: url.origin, state: 'open' }
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (workspace) workspace.detail.previews = [preview, ...workspace.detail.previews]
    return preview
  },
  async codeRuns(workspaceId?: string): Promise<CodeRunSummary[]> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeRunSummary[]>('agentic_super_app_query_code_runs', { workspaceId: workspaceId ?? null })
    return [...previewCodeRuns.values()].filter((detail) => !workspaceId || detail.summary.workspace_id === workspaceId).map((detail) => structuredClone(detail.summary)).sort((a, b) => b.updated_at_unix_ms - a.updated_at_unix_ms)
  },
  async codeRun(runId: string): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeRunDetail>('agentic_super_app_query_code_run', { runId })
    return previewCodeRunDetail(runId)
  },
  async createCodeRun(request: CodeRunCreateRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeRunCreateRequest, CodeRunDetail>('agentic_super_app_command_create_code_run', request)
    if (!previewCodeWorkspaces.has(request.workspace_id)) throw new Error('Open a workspace before creating a run.')
    const summary = { ...previewCodeRunSummary(request.workspace_id, request.title, request.objective), review_policy: request.review_policy, concurrency_limit: request.concurrency_limit ?? 2 }
    const detail: CodeRunDetail = { summary, tasks: [], dependencies: [], dispatches: [], worktrees: [], checkpoints: [], reviews: [], questions: [], messages: [], events: [], event_cursor: 0, proposal: null }
    previewCodeRuns.set(summary.id, detail)
    previewCodeRunEvent(detail, 'Run created')
    return structuredClone(detail)
  },
  async updateCodeRun(request: CodeRunUpdateRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeRunUpdateRequest, CodeRunDetail>('agentic_super_app_command_update_code_run', request)
    const detail = previewCodeRuns.get(request.run_id)
    if (!detail) throw new Error('Run was not found.')
    Object.assign(detail.summary, { title: request.title, objective: request.objective, review_policy: request.review_policy, concurrency_limit: request.concurrency_limit ?? detail.summary.concurrency_limit })
    previewCodeRunEvent(detail, 'Run updated')
    return structuredClone(detail)
  },
  async createCodeTask(request: CodeTaskCreateRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeTaskCreateRequest, CodeRunDetail>('agentic_super_app_command_create_code_task', request)
    const detail = previewCodeRuns.get(request.run_id)
    if (!detail) throw new Error('Run was not found.')
    const taskId = previewId('task')
    const now = previewNow()
    const task: CodeTask = { id: taskId, run_id: request.run_id, client_id: request.client_id?.trim() || taskId, title: request.title, specification: request.specification, state: 'draft', position: detail.tasks.length, active_dispatch_id: null, latest_checkpoint_id: null, base_checkpoint_id: null, attempt: 0, error: null, created_at_unix_ms: now, updated_at_unix_ms: now }
    detail.tasks.push(task)
    request.depends_on.forEach((dependency) => { const target = detail.tasks.find((candidate) => candidate.id === dependency || candidate.client_id === dependency); if (target && target.id !== task.id) detail.dependencies.push({ run_id: request.run_id, task_id: task.id, depends_on_task_id: target.id }) })
    previewRecountRun(detail)
    previewCodeRunEvent(detail, 'Task added', task.id)
    return structuredClone(detail)
  },
  async updateCodeTask(request: CodeTaskUpdateRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeTaskUpdateRequest, CodeRunDetail>('agentic_super_app_command_update_code_task', request)
    const detail = previewCodeRuns.get(request.run_id)
    const task = detail?.tasks.find((candidate) => candidate.id === request.task_id || candidate.client_id === request.task_id)
    if (!detail || !task) throw new Error('Task was not found.')
    task.title = request.title; task.specification = request.specification; task.state = 'draft'; task.updated_at_unix_ms = previewNow()
    detail.dependencies = detail.dependencies.filter((dependency) => dependency.task_id !== task.id)
    request.depends_on.forEach((dependency) => { const target = detail.tasks.find((candidate) => candidate.id === dependency || candidate.client_id === dependency); if (target && target.id !== task.id) detail.dependencies.push({ run_id: request.run_id, task_id: task.id, depends_on_task_id: target.id }) })
    previewCodeRunEvent(detail, 'Task updated', task.id)
    return structuredClone(detail)
  },
  async deleteCodeTask(request: CodeTaskDeleteRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeTaskDeleteRequest, CodeRunDetail>('agentic_super_app_command_delete_code_task', request)
    const detail = previewCodeRuns.get(request.run_id)
    if (!detail) throw new Error('Run was not found.')
    const task = detail.tasks.find((candidate) => candidate.id === request.task_id || candidate.client_id === request.task_id)
    if (!task) throw new Error('Task was not found.')
    detail.tasks = detail.tasks.filter((candidate) => candidate.id !== task.id)
    detail.dependencies = detail.dependencies.filter((dependency) => dependency.task_id !== task.id && dependency.depends_on_task_id !== task.id)
    previewRecountRun(detail); previewCodeRunEvent(detail, 'Task deleted', task.id)
    return structuredClone(detail)
  },
  async proposeCodeDag(request: CodeDagProposalRequest): Promise<CodeDagProposal> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeDagProposalRequest, CodeDagProposal>('agentic_super_app_command_propose_code_dag', request)
    return { objective: request.objective, tasks: [{ client_id: 'inspect', title: 'Inspect the repository', specification: 'Inspect the existing repository and identify the smallest safe implementation boundary.', depends_on: [] }, { client_id: 'implement', title: 'Implement the objective', specification: request.objective, depends_on: ['inspect'] }, { client_id: 'verify', title: 'Verify the change', specification: 'Run focused checks and report the result.', depends_on: ['implement'] }], warnings: ['Browser preview uses a deterministic proposal; the desktop host can ask Codex for a reviewed structured proposal.'] }
  },
  async acceptCodeDag(request: CodeDagProposalAcceptRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeDagProposalAcceptRequest, CodeRunDetail>('agentic_super_app_command_accept_code_dag', request)
    const detail = previewCodeRuns.get(request.run_id)
    if (!detail) throw new Error('Run was not found.')
    const ids = new Map(request.proposal.tasks.map((task) => [task.client_id, previewId('task')]))
    const now = previewNow()
    detail.tasks = request.proposal.tasks.map((proposalTask, position) => ({ id: ids.get(proposalTask.client_id)!, run_id: request.run_id, client_id: proposalTask.client_id, title: proposalTask.title, specification: proposalTask.specification, state: 'ready', position, active_dispatch_id: null, latest_checkpoint_id: null, base_checkpoint_id: null, attempt: 0, error: null, created_at_unix_ms: now, updated_at_unix_ms: now }))
    detail.dependencies = request.proposal.tasks.flatMap((task) => task.depends_on.flatMap((dependency) => ids.has(dependency) ? [{ run_id: request.run_id, task_id: ids.get(task.client_id)!, depends_on_task_id: ids.get(dependency)! }] : []))
    detail.proposal = structuredClone(request.proposal); detail.summary.state = 'ready'; previewRecountRun(detail); previewCodeRunEvent(detail, 'DAG proposal accepted')
    return structuredClone(detail)
  },
  async startCodeRun(request: CodeRunRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeRunRequest, CodeRunDetail>('agentic_super_app_command_start_code_run', request)
    const detail = previewCodeRuns.get(request.run_id)
    if (!detail) throw new Error('Run was not found.')
    detail.tasks.forEach((task) => { if (task.state === 'draft' || task.state === 'blocked') task.state = 'ready' })
    detail.summary.state = 'running'; previewCodeRunEvent(detail, 'Run started'); previewAdvanceRun(request.run_id)
    return structuredClone(detail)
  },
  async pauseCodeRun(request: CodeRunRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeRunRequest, CodeRunDetail>('agentic_super_app_command_pause_code_run', request)
    const detail = previewCodeRuns.get(request.run_id); if (!detail) throw new Error('Run was not found.')
    detail.summary.state = 'paused'; previewCodeRunEvent(detail, 'Run paused'); return structuredClone(detail)
  },
  async cancelCodeRun(request: CodeRunRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeRunRequest, CodeRunDetail>('agentic_super_app_command_cancel_code_run', request)
    const detail = previewCodeRuns.get(request.run_id); if (!detail) throw new Error('Run was not found.')
    detail.summary.state = 'cancelled'; previewCodeRunEvent(detail, 'Run cancelled'); return structuredClone(detail)
  },
  async answerCodeQuestion(request: CodeQuestionAnswerRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeQuestionAnswerRequest, CodeRunDetail>('agentic_super_app_command_answer_code_question', request)
    return previewCodeRunDetail(request.run_id)
  },
  async retryCodeTask(request: CodeTaskRetryRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeTaskRetryRequest, CodeRunDetail>('agentic_super_app_command_retry_code_task', request)
    const detail = previewCodeRuns.get(request.run_id); const task = detail?.tasks.find((candidate) => candidate.id === request.task_id)
    if (!detail || !task) throw new Error('Task was not found.')
    task.state = 'ready'; detail.summary.state = 'running'; previewCodeRunEvent(detail, 'Task queued for retry', task.id); previewAdvanceRun(request.run_id); return structuredClone(detail)
  },
  async reviewCodeCheckpoint(request: CodeReviewRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeReviewRequest, CodeRunDetail>('agentic_super_app_command_review_code_checkpoint', request)
    const detail = previewCodeRuns.get(request.run_id); const task = detail?.tasks.find((candidate) => candidate.id === request.task_id)
    if (!detail || !task) throw new Error('Task was not found.')
    task.state = request.decision === 'accept' ? 'completed' : request.decision === 'reject' ? 'failed' : 'ready'; detail.summary.state = request.decision === 'reject' ? 'failed' : 'running'; previewCodeRunEvent(detail, request.decision === 'accept' ? 'Checkpoint accepted' : request.decision === 'reject' ? 'Checkpoint rejected' : 'Changes requested', task.id); previewRecountRun(detail); if (request.decision !== 'reject') previewAdvanceRun(request.run_id); return structuredClone(detail)
  },
  async codeCleanupPreview(request: CodeCleanupPreviewRequest): Promise<CodeCleanupPreview> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeCleanupPreview>('agentic_super_app_query_code_cleanup_preview', { request })
    const detail = previewCodeRunDetail(request.run_id); const worktree = detail.worktrees.find((candidate) => candidate.id === request.worktree_id)
    if (!worktree) throw new Error('Worktree was not found.')
    return { worktree_id: worktree.id, path: worktree.path, branch: worktree.branch, dirty_files: [], locked: worktree.locked, can_remove: !worktree.locked, reason: worktree.locked ? 'The preview worker lease still holds this worktree.' : null }
  },
  async codeCheckpointDiff(request: CodeCheckpointDiffRequest): Promise<CodeGitDiff> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeGitDiff>('agentic_super_app_query_code_checkpoint_diff', { request })
    const detail = previewCodeRunDetail(request.run_id)
    const checkpoint = detail.checkpoints.find((candidate) => candidate.id === request.checkpoint_id)
    return { workspace_id: detail.summary.workspace_id, relative_path: null, content: checkpoint ? `# Preview checkpoint diff\n${checkpoint.summary}` : '', binary: false, truncated: false }
  },
  async confirmCodeCleanup(request: CodeCleanupConfirmRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeCleanupConfirmRequest, CodeRunDetail>('agentic_super_app_command_confirm_code_cleanup', request)
    const detail = previewCodeRunDetail(request.run_id); const worktree = detail.worktrees.find((candidate) => candidate.id === request.worktree_id); if (!worktree) throw new Error('Worktree was not found.')
    worktree.state = 'removed'; worktree.locked = false; previewCodeRunEvent(detail, 'Worktree removed', worktree.task_id); return structuredClone(detail)
  },
  subscribeCodeOrchestration(runId: string, onEvent: (event: CodeOrchestrationEventEnvelope) => void, afterSequence = 0): () => void {
    if (agenticSuperAppIsTauri) {
      const channel = new Channel<CodeOrchestrationEventEnvelope>(onEvent)
      void invoke('agentic_super_app_stream_code_orchestration_events', { query: { run_id: runId, after_sequence: afterSequence, limit: 500 }, channel })
      return () => undefined
    }
    const subscriber = (event: CodeOrchestrationEventEnvelope) => { if (event.run_id === runId && event.sequence > afterSequence) onEvent(event) }
    previewCodeSubscribers.add(subscriber); return () => previewCodeSubscribers.delete(subscriber)
  },
  async chooseWorkspacePath(): Promise<string | null> {
    if (!agenticSuperAppIsTauri) return '~/agentic-demo'
    const selected = await openDialog({ multiple: false, directory: true, title: 'Open workspace folder' })
    return typeof selected === 'string' ? selected : null
  },

  async chatSidebar(query: { search?: string; archived: boolean; limit?: number }): Promise<ChatSidebarPage> {
    if (agenticSuperAppIsTauri) return tauriQuery<ChatSidebarPage>('agentic_super_app_query_chat_sidebar', { query: { search: query.search ?? null, archived: query.archived, limit: query.limit ?? 50 } })
    return previewResponse({ conversations: [...previewConversations.values()].map(previewSummary).filter((item) => item.archived === query.archived && (!query.search || `${item.title} ${item.preview ?? ''}`.toLowerCase().includes(query.search.toLowerCase()))).sort((a, b) => b.updated_at_unix_ms - a.updated_at_unix_ms), next_cursor: null })
  },
  async chatConversation(conversationId: string): Promise<ChatConversationDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<ChatConversationDetail>('agentic_super_app_query_chat_conversation', { conversationId })
    const detail = previewConversations.get(conversationId)
    if (!detail) throw new Error('Conversation was not found.')
    return previewResponse(structuredClone(detail))
  },
  async createChat(title?: string): Promise<ChatConversationDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<ChatCreateRequest, ChatConversationDetail>('agentic_super_app_command_create_chat', { title: title?.trim() || null })
    const detail = previewDetail(title?.trim() || 'New chat')
    previewConversations.set(detail.id, detail)
    return previewResponse(structuredClone(detail))
  },
  async updateChat(payload: { conversation_id: string; title?: string | null; pinned?: boolean | null; archived?: boolean | null }): Promise<ChatConversationDetail> {
    const request: ChatMetadataRequest = { conversation_id: payload.conversation_id, title: payload.title ?? null, pinned: payload.pinned ?? null, archived: payload.archived ?? null }
    if (agenticSuperAppIsTauri) return tauriCommand<ChatMetadataRequest, ChatConversationDetail>('agentic_super_app_command_update_chat', request)
    const detail = previewConversations.get(request.conversation_id)
    if (!detail) throw new Error('Conversation was not found.')
    if (request.title !== null) detail.title = request.title || 'New chat'
    if (request.pinned !== null) detail.pinned = request.pinned
    if (request.archived !== null) detail.archived = request.archived
    detail.updated_at_unix_ms = previewNow()
    return previewResponse(structuredClone(detail))
  },
  async deleteChat(conversationId: string): Promise<boolean> {
    if (agenticSuperAppIsTauri) return tauriCommand<ChatDeleteRequest, boolean>('agentic_super_app_command_delete_chat', { conversation_id: conversationId })
    return previewResponse(previewConversations.delete(conversationId))
  },
  async saveChatDraft(conversationId: string, draft: string): Promise<void> {
    if (agenticSuperAppIsTauri) { await tauriCommand<ChatDraftRequest, null>('agentic_super_app_command_save_chat_draft', { conversation_id: conversationId, draft }); return }
    const detail = previewConversations.get(conversationId)
    if (detail) detail.draft = draft
  },
  async importChatAttachments(request: ChatAttachmentImportRequest): Promise<ChatAttachmentSummary[]> {
    if (agenticSuperAppIsTauri) return tauriCommand<ChatAttachmentImportRequest, ChatAttachmentSummary[]>('agentic_super_app_command_import_chat_attachments', request)
    return previewResponse(request.paths.map((path) => ({ id: previewId('attachment'), display_name: path.split(/[\\/]/).pop() || 'attachment', mime_type: 'text/plain', bytes: 0, sha256: 'preview' })))
  },
  async deleteChatAttachment(request: ChatDeleteAttachmentRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<ChatDeleteAttachmentRequest, boolean>('agentic_super_app_command_delete_chat_attachment', request) : true },
  async startChatTurn(request: ChatSendRequest): Promise<ChatConversationDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<ChatSendRequest, ChatConversationDetail>('agentic_super_app_command_start_chat_turn', request)
    const detail = previewConversations.get(request.conversation_id)
    if (!detail) throw new Error('Conversation was not found.')
    const now = previewNow()
    const userId = previewId('message')
    const assistantId = previewId('message')
    const turnId = previewId('turn')
    detail.messages.push({ id: userId, branch_id: request.branch_id, role: 'user', parts: [{ kind: 'text', text: request.text }], created_at_unix_ms: now, turn_id: turnId })
    detail.messages.push({ id: assistantId, branch_id: request.branch_id, role: 'assistant', parts: [{ kind: 'text', text: 'Preview response: your local chat vertical slice is connected and ready for a provider key.' }], created_at_unix_ms: now, turn_id: turnId })
    detail.turns.push({ id: turnId, message_id: userId, assistant_message_id: assistantId, branch_id: request.branch_id, provider_account_id: request.provider_account_id, model: request.model, reasoning_effort: request.reasoning_effort, state: 'completed', job_id: 'preview-job', input_tokens: null, output_tokens: null, created_at_unix_ms: now, updated_at_unix_ms: now })
    detail.updated_at_unix_ms = now
    previewEvent(detail, 'assistant_text_appended', assistantId, 'Preview response: your local chat vertical slice is connected and ready for a provider key.', null)
    previewEvent(detail, 'turn_completed', assistantId, null, null)
    return previewResponse(structuredClone(detail))
  },
  async cancelChatTurn(request: ChatTurnRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<ChatTurnRequest, boolean>('agentic_super_app_command_cancel_chat_turn', request) : true },
  async retryChatTurn(request: ChatTurnRequest): Promise<ChatConversationDetail> { return agenticSuperAppIsTauri ? tauriCommand<ChatTurnRequest, ChatConversationDetail>('agentic_super_app_command_retry_chat_turn', request) : this.startChatTurn({ conversation_id: request.conversation_id, branch_id: previewConversations.get(request.conversation_id)?.active_branch_id ?? '', text: 'Retry the previous response.', attachment_ids: [], provider_account_id: previewProvider.id, model: request.model ?? previewProvider.default_model ?? 'preview', reasoning_effort: request.reasoning_effort ?? 'auto' }) },
  async editChatMessage(request: ChatEditRequest): Promise<ChatConversationDetail> { return agenticSuperAppIsTauri ? tauriCommand<ChatEditRequest, ChatConversationDetail>('agentic_super_app_command_edit_chat_message', request) : this.startChatTurn({ conversation_id: request.conversation_id, branch_id: previewConversations.get(request.conversation_id)?.active_branch_id ?? '', text: request.text, attachment_ids: [], provider_account_id: request.provider_account_id, model: request.model, reasoning_effort: request.reasoning_effort }) },
  async branchChat(request: ChatBranchRequest): Promise<ChatConversationDetail> { return agenticSuperAppIsTauri ? tauriCommand<ChatBranchRequest, ChatConversationDetail>('agentic_super_app_command_branch_chat', request) : this.chatConversation(request.conversation_id) },
  async exportChat(request: ChatExportRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<ChatExportRequest, boolean>('agentic_super_app_command_export_chat', request) : true },
  subscribeChat(onEvent: (event: ChatEventEnvelope) => void, afterGlobalSequence = 0): () => void {
    if (!agenticSuperAppIsTauri) { previewSubscribers.add(onEvent); return () => previewSubscribers.delete(onEvent) }
    const channel = new Channel<ChatEventEnvelope>(onEvent)
    void invoke('agentic_super_app_stream_chat_events', { request: { after_global_sequence: afterGlobalSequence }, channel })
    return () => undefined
  },
  async chooseAttachmentPaths(): Promise<string[]> {
    if (!agenticSuperAppIsTauri) return []
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: 'Chat attachments', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'markdown'] }] })
    if (!selected) return []
    return Array.isArray(selected) ? selected : [selected]
  },
  async chooseExportDestination(suggestedName = 'chat-export.zip'): Promise<string | null> {
    if (!agenticSuperAppIsTauri) return `${suggestedName}`
    return saveDialog({ defaultPath: suggestedName, filters: [{ name: 'Chat export', extensions: ['zip'] }] })
  },
  isTauri: agenticSuperAppIsTauri,
}
