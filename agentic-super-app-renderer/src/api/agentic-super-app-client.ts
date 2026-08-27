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

const protocol: ProtocolVersion = { major: 1, minor: 0, patch: 0 }
const agenticSuperAppIsTauri = '__TAURI_INTERNALS__' in window
const previewProvider: ProviderAccountSummary = { id: 'agentic-super-app-openai', display_name: 'OpenAI Responses', default_model: 'gpt-5.6-mini', secret_configured: false, enabled: true }
const previewConversations = new Map<string, ChatConversationDetail>()
const previewSubscribers = new Set<(event: ChatEventEnvelope) => void>()

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
