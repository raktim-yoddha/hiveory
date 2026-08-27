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

const protocol: ProtocolVersion = { major: 1, minor: 0, patch: 0 }
const agenticSuperAppIsTauri = '__TAURI_INTERNALS__' in window
const previewProvider: ProviderAccountSummary = { id: 'agentic-super-app-openai', display_name: 'OpenAI Responses', default_model: 'gpt-5.6-mini', secret_configured: false, enabled: true }
const previewConversations = new Map<string, ChatConversationDetail>()
const previewSubscribers = new Set<(event: ChatEventEnvelope) => void>()
const previewCodeWorkspaces = new Map<string, { detail: CodeWorkspaceDetail; files: Map<string, CodeDocument> }>()

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
