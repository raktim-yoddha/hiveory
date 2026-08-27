import {
  Archive,
  ArchiveRestore,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Download,
  Edit3,
  FileText,
  GitBranch,
  Image as ImageIcon,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Square,
  Star,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  agenticSuperAppClient,
  type ChatAttachmentSummary,
  type ChatConversationDetail,
  type ChatMessage,
  type ChatMessagePart,
  type ChatReasoningEffort,
  type ChatTurnSummary,
  type DiagnosticSnapshot,
} from '../api/agentic-super-app-client'

type ChatFilter = 'recent' | 'pinned' | 'archive'
type PendingEdit = { messageId: string; text: string }

const providerFallback = 'agentic-super-app-openai'
const modelFallback = 'gpt-5.6-mini'
const reasoningOptions: Array<{ value: ChatReasoningEffort; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export function AgenticSuperAppChat() {
  const [filter, setFilter] = useState<ChatFilter>('recent')
  const [search, setSearch] = useState('')
  const [conversations, setConversations] = useState<Awaited<ReturnType<typeof agenticSuperAppClient.chatSidebar>>['conversations']>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChatConversationDetail | null>(null)
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>({ providers: [], recent_jobs: [], notifications: [], recovery_message: null })
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachmentSummary[]>([])
  const [model, setModel] = useState(modelFallback)
  const [providerId, setProviderId] = useState(providerFallback)
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>('auto')
  const [titleDraft, setTitleDraft] = useState('')
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const initialisedRef = useRef(false)
  const loadedConversationRef = useRef<string | null>(null)
  const transcriptRef = useRef<HTMLElement | null>(null)
  const eventCursorRef = useRef(0)

  const provider = snapshot.providers.find((item) => item.id === providerId) ?? snapshot.providers[0]
  const activeTurn = useMemo(() => detail?.turns.find((turn) => turn.branch_id === detail.active_branch_id && ['queued', 'streaming', 'cancel_requested'].includes(turn.state)), [detail])
  const activeTurnForMessage = (message: ChatMessage): ChatTurnSummary | undefined => detail?.turns.find((turn) => turn.id === message.turn_id || turn.assistant_message_id === message.id || turn.message_id === message.id)

  const loadSidebar = useCallback(async () => {
    try {
      const page = await agenticSuperAppClient.chatSidebar({ search: search.trim() || undefined, archived: filter === 'archive' })
      const values = filter === 'pinned' ? page.conversations.filter((item) => item.pinned && !item.archived) : page.conversations
      setConversations(values)
      if (selectedIdRef.current && !values.some((item) => item.id === selectedIdRef.current) && filter !== 'archive') setSelectedId(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Conversations could not be loaded.')
    }
  }, [filter, search])

  const loadDetail = useCallback(async (conversationId: string) => {
    try {
      const next = await agenticSuperAppClient.chatConversation(conversationId)
      if (selectedIdRef.current === conversationId) {
        setDetail(next)
        setTitleDraft(next.title)
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Conversation could not be loaded.')
    }
  }, [])

  useEffect(() => {
    void loadSidebar()
  }, [loadSidebar])

  useEffect(() => {
    let cancelled = false
    const initialise = async () => {
      try {
        const diagnosticSnapshot = await agenticSuperAppClient.diagnostics()
        if (cancelled) return
        setSnapshot(diagnosticSnapshot)
        const page = await agenticSuperAppClient.chatSidebar({ archived: false, limit: 1 })
        if (cancelled) return
        if (page.conversations[0]) {
          selectedIdRef.current = page.conversations[0].id
          setSelectedId(page.conversations[0].id)
          await loadDetail(page.conversations[0].id)
        } else {
          const created = await agenticSuperAppClient.createChat()
          if (cancelled) return
          selectedIdRef.current = created.id
          setSelectedId(created.id)
          setDetail(created)
          setTitleDraft(created.title)
          await loadSidebar()
        }
        initialisedRef.current = true
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : 'Chat could not be initialised.')
      }
    }
    if (!initialisedRef.current) void initialise()
    return () => { cancelled = true }
  }, [loadDetail, loadSidebar])

  useEffect(() => {
    if (!selectedId) return
    selectedIdRef.current = selectedId
    void loadDetail(selectedId)
  }, [loadDetail, selectedId])

  useEffect(() => {
    const savedCursor = Number.parseInt(window.sessionStorage.getItem('agentic-super-app-chat-event-cursor') ?? '0', 10)
    eventCursorRef.current = Number.isFinite(savedCursor) ? savedCursor : 0
    return agenticSuperAppClient.subscribeChat((event) => {
      eventCursorRef.current = Math.max(eventCursorRef.current, event.global_sequence)
      window.sessionStorage.setItem('agentic-super-app-chat-event-cursor', String(eventCursorRef.current))
      const currentId = selectedIdRef.current
      if (currentId && event.conversation_id === currentId) void loadDetail(currentId)
    }, eventCursorRef.current)
  }, [loadDetail])

  useEffect(() => {
    if (!detail || loadedConversationRef.current === detail.id) return
    loadedConversationRef.current = detail.id
    setDraft(detail.draft)
    setTitleDraft(detail.title)
    setAttachments([])
  }, [detail])

  useEffect(() => {
    if (!provider) return
    setProviderId(provider.id)
    if (provider.default_model) setModel(provider.default_model)
  }, [provider])

  useEffect(() => {
    if (!detail || draft === detail.draft) return
    const timer = window.setTimeout(() => { void agenticSuperAppClient.saveChatDraft(detail.id, draft) }, 400)
    return () => window.clearTimeout(timer)
  }, [detail, draft])

  useEffect(() => {
    const node = transcriptRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [detail?.messages.length, activeTurn?.state])

  const selectConversation = (conversationId: string) => {
    selectedIdRef.current = conversationId
    loadedConversationRef.current = null
    setSelectedId(conversationId)
    setStatus(null)
  }

  const createConversation = async () => {
    setBusy('create')
    setStatus(null)
    try {
      const created = await agenticSuperAppClient.createChat()
      selectedIdRef.current = created.id
      loadedConversationRef.current = created.id
      setSelectedId(created.id)
      setDetail(created)
      setTitleDraft(created.title)
      setDraft('')
      await loadSidebar()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'New chat could not be created.')
    } finally {
      setBusy(null)
    }
  }

  const updateMetadata = async (payload: { title?: string | null; pinned?: boolean | null; archived?: boolean | null }, message: string) => {
    if (!detail) return
    setBusy('metadata')
    try {
      const next = await agenticSuperAppClient.updateChat({ conversation_id: detail.id, ...payload })
      setDetail(next)
      setTitleDraft(next.title)
      setStatus(message)
      await loadSidebar()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Chat metadata could not be updated.')
    } finally {
      setBusy(null)
    }
  }

  const renameConversation = () => {
    const title = titleDraft.trim()
    if (title && title !== detail?.title) void updateMetadata({ title }, 'Chat renamed.')
  }

  const deleteConversation = async () => {
    if (!detail || !window.confirm(`Delete “${detail.title}”? This removes the conversation and owned attachments.`)) return
    setBusy('delete')
    try {
      await agenticSuperAppClient.deleteChat(detail.id)
      setDetail(null)
      selectedIdRef.current = null
      setSelectedId(null)
      setStatus('Chat deleted.')
      await loadSidebar()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Chat could not be deleted.')
    } finally {
      setBusy(null)
    }
  }

  const importAttachments = async () => {
    if (!detail) return
    setBusy('attach')
    try {
      const paths = await agenticSuperAppClient.chooseAttachmentPaths()
      if (!paths.length) return
      const imported = await agenticSuperAppClient.importChatAttachments({ conversation_id: detail.id, message_id: null, paths })
      setAttachments((items) => [...items, ...imported])
      setStatus(`${imported.length} attachment${imported.length === 1 ? '' : 's'} ready for this turn.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Attachment import was rejected.')
    } finally {
      setBusy(null)
    }
  }

  const sendMessage = async () => {
    if (!detail || (!draft.trim() && !attachments.length) || activeTurn) return
    setBusy('send')
    setStatus(null)
    try {
      const next = await agenticSuperAppClient.startChatTurn({ conversation_id: detail.id, branch_id: detail.active_branch_id, text: draft.trim(), attachment_ids: attachments.map((item) => item.id), provider_account_id: provider?.id ?? providerId, model: model.trim() || modelFallback, reasoning_effort: reasoningEffort })
      await agenticSuperAppClient.saveChatDraft(detail.id, '')
      setDraft('')
      setAttachments([])
      setDetail(next)
      setStatus(agenticSuperAppClient.isTauri ? 'Response streaming…' : 'Preview response completed.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The response could not be started.')
    } finally {
      setBusy(null)
    }
  }

  const stopResponse = async () => {
    if (!detail || !activeTurn) return
    setBusy('stop')
    try {
      await agenticSuperAppClient.cancelChatTurn({ conversation_id: detail.id, turn_id: activeTurn.id, model: activeTurn.model, reasoning_effort: activeTurn.reasoning_effort })
      setStatus('Stop requested. Finishing the current persistence boundary…')
      await loadDetail(detail.id)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The response could not be stopped.')
    } finally {
      setBusy(null)
    }
  }

  const retryResponse = async (turn: ChatTurnSummary) => {
    if (!detail) return
    setBusy('retry')
    try {
      const next = await agenticSuperAppClient.retryChatTurn({ conversation_id: detail.id, turn_id: turn.id, model: model || turn.model, reasoning_effort: reasoningEffort || turn.reasoning_effort })
      setDetail(next)
      setStatus('Retry started on a new branch.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Retry could not be started.')
    } finally {
      setBusy(null)
    }
  }

  const branchMessage = async (messageId: string) => {
    if (!detail) return
    setBusy('branch')
    try {
      const next = await agenticSuperAppClient.branchChat({ conversation_id: detail.id, message_id: messageId })
      setDetail(next)
      setStatus('Branch created. New messages will stay isolated from the original path.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Branch could not be created.')
    } finally {
      setBusy(null)
    }
  }

  const saveEdit = async () => {
    if (!detail || !pendingEdit?.text.trim()) return
    setBusy('edit')
    try {
      const next = await agenticSuperAppClient.editChatMessage({ conversation_id: detail.id, message_id: pendingEdit.messageId, text: pendingEdit.text.trim(), provider_account_id: provider?.id ?? providerId, model: model || modelFallback, reasoning_effort: reasoningEffort })
      setDetail(next)
      setPendingEdit(null)
      setStatus('Edited message branched into a new response path.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Message could not be edited.')
    } finally {
      setBusy(null)
    }
  }

  const exportConversation = async () => {
    if (!detail) return
    setBusy('export')
    try {
      const destination = await agenticSuperAppClient.chooseExportDestination(`${detail.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'chat'}-export.zip`)
      if (!destination) return
      await agenticSuperAppClient.exportChat({ conversation_id: detail.id, branch_id: detail.active_branch_id, destination })
      setStatus(`Exported portable chat to ${destination}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Chat export could not be written.')
    } finally {
      setBusy(null)
    }
  }

  const filterLabel = filter === 'archive' ? 'Archive' : filter === 'pinned' ? 'Pinned' : 'Recent'
  const contextTokens = Math.ceil((draft.length + (detail?.messages.reduce((total, message) => total + message.parts.reduce((partTotal, part) => partTotal + partTextLength(part), 0), 0) ?? 0)) / 4)

  return <section className="agentic-super-app-chat" aria-labelledby="agentic-super-app-chat-title">
    <aside className="agentic-super-app-chat-sidebar" aria-label="Chat conversations">
      <div className="agentic-super-app-chat-sidebar-heading"><div><p className="agentic-super-app-eyebrow">Focused mode</p><h1 id="agentic-super-app-chat-title">Chats</h1></div><button className="agentic-super-app-icon-button" type="button" onClick={createConversation} disabled={busy !== null} aria-label="New chat" title="New chat"><Plus size={17} /></button></div>
      <button className="agentic-super-app-chat-new-button" type="button" onClick={createConversation} disabled={busy !== null}><Plus size={16} />New chat</button>
      <label className="agentic-super-app-search-field"><Search size={15} aria-hidden="true" /><span className="agentic-super-app-visually-hidden">Search conversations</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /></label>
      <div className="agentic-super-app-chat-filters" role="tablist" aria-label="Conversation views">
        {([['recent', 'Recent', Star], ['pinned', 'Pinned', Pin], ['archive', 'Archive', Archive]] as const).map(([value, label, Icon]) => <button key={value} className={filter === value ? 'is-active' : ''} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}><Icon size={14} aria-hidden="true" />{label}</button>)}
      </div>
      <div className="agentic-super-app-chat-list" role="list">
        {conversations.map((conversation) => <button key={conversation.id} className={`agentic-super-app-chat-list-item ${selectedId === conversation.id ? 'is-selected' : ''}`} type="button" role="listitem" onClick={() => selectConversation(conversation.id)}><span className="agentic-super-app-chat-list-title">{conversation.title}</span><span className="agentic-super-app-chat-list-preview">{conversation.preview || 'No messages yet'}</span><span className="agentic-super-app-chat-list-meta">{conversation.pinned ? 'Pinned · ' : ''}{relativeTime(conversation.updated_at_unix_ms)}</span></button>)}
        {!conversations.length && <div className="agentic-super-app-chat-list-empty"><Search size={20} /><p>No {filterLabel.toLowerCase()} chats.</p><button type="button" onClick={createConversation}>Start a chat</button></div>}
      </div>
      <div className="agentic-super-app-chat-sidebar-footer"><ShieldCheck size={14} aria-hidden="true" /><span>Local replay · tools off · attachments copied</span></div>
    </aside>
    <section className="agentic-super-app-chat-main" aria-label="Conversation">
      {detail ? <>
        <header className="agentic-super-app-chat-header">
          <div className="agentic-super-app-chat-title-wrap"><Bot size={19} aria-hidden="true" /><div><label className="agentic-super-app-visually-hidden" htmlFor="agentic-super-app-chat-title-input">Conversation title</label><input id="agentic-super-app-chat-title-input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={renameConversation} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); renameConversation(); event.currentTarget.blur() } }} /><p>{detail.branches.length > 1 ? `${detail.branches.length} branches` : 'Main branch'} · {agenticSuperAppClient.isTauri ? 'Desktop host' : 'Preview mode'}</p></div></div>
          <div className="agentic-super-app-chat-header-actions">
            <button className="agentic-super-app-icon-button" type="button" onClick={() => void updateMetadata({ pinned: !detail.pinned }, detail.pinned ? 'Removed from pinned.' : 'Pinned chat.')} disabled={busy !== null} aria-label={detail.pinned ? 'Unpin chat' : 'Pin chat'} title={detail.pinned ? 'Unpin chat' : 'Pin chat'}><Pin size={16} fill={detail.pinned ? 'currentColor' : 'none'} /></button>
            <button className="agentic-super-app-icon-button" type="button" onClick={() => void updateMetadata({ archived: !detail.archived }, detail.archived ? 'Chat restored.' : 'Chat archived.')} disabled={busy !== null} aria-label={detail.archived ? 'Restore chat' : 'Archive chat'} title={detail.archived ? 'Restore chat' : 'Archive chat'}>{detail.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>
            <button className="agentic-super-app-icon-button" type="button" onClick={() => void exportConversation()} disabled={busy !== null} aria-label="Export chat" title="Export chat"><Download size={16} /></button>
            <button className="agentic-super-app-icon-button is-danger" type="button" onClick={() => void deleteConversation()} disabled={busy !== null} aria-label="Delete chat" title="Delete chat"><Trash2 size={16} /></button>
          </div>
        </header>
        <div className="agentic-super-app-chat-context-bar"><span><Zap size={14} aria-hidden="true" />{model || modelFallback}</span><span><ShieldCheck size={14} aria-hidden="true" />Tools off</span><span>Context ~{contextTokens.toLocaleString()} tokens · 128k policy</span>{detail.branches.length > 1 && <span className="agentic-super-app-branch-badge"><GitBranch size={13} />{detail.branches.find((branch) => branch.active)?.label ?? 'Active branch'}</span>}</div>
        <main className="agentic-super-app-chat-transcript" ref={transcriptRef} aria-live="polite" aria-label="Message transcript">
          {!detail.messages.length && <div className="agentic-super-app-chat-empty"><div className="agentic-super-app-empty-mark"><MessageGlyph /></div><h2>Start a focused conversation</h2><p>Ask a question, attach a PDF or image, and keep the response on this branch. Nothing is sent until you press Send.</p></div>}
          {detail.messages.map((message) => <ChatMessageView key={message.id} message={message} turn={activeTurnForMessage(message)} onEdit={message.role === 'user' ? () => setPendingEdit({ messageId: message.id, text: messageText(message) }) : undefined} onBranch={() => void branchMessage(message.id)} onRetry={message.role === 'assistant' && activeTurnForMessage(message) ? () => void retryResponse(activeTurnForMessage(message)!) : undefined} />)}
          {activeTurn && <div className="agentic-super-app-chat-streaming-status" role="status"><span className="agentic-super-app-pulse" aria-hidden="true" />{activeTurn.state === 'cancel_requested' ? 'Stopping response…' : 'Generating response…'}<span className="agentic-super-app-dot-loader" aria-hidden="true">•••</span></div>}
        </main>
        {pendingEdit && <form className="agentic-super-app-chat-edit" onSubmit={(event) => { event.preventDefault(); void saveEdit() }}><div className="agentic-super-app-chat-edit-heading"><span>Edit message</span><button type="button" className="agentic-super-app-icon-button" onClick={() => setPendingEdit(null)} aria-label="Cancel edit" title="Cancel edit"><X size={15} /></button></div><textarea value={pendingEdit.text} onChange={(event) => setPendingEdit({ ...pendingEdit, text: event.target.value })} rows={3} autoFocus /><div><button className="is-secondary" type="button" onClick={() => setPendingEdit(null)}>Cancel</button><button type="submit" disabled={busy !== null || !pendingEdit.text.trim()}><Check size={14} />Save and branch</button></div></form>}
        {status && <div className="agentic-super-app-chat-status" role="status">{status}</div>}
        <form className="agentic-super-app-chat-composer" onSubmit={(event) => { event.preventDefault(); if (activeTurn) void stopResponse(); else void sendMessage() }}>
          {attachments.length > 0 && <div className="agentic-super-app-chat-attachments" aria-label="Attachments for next message">{attachments.map((attachment) => <span key={attachment.id} className="agentic-super-app-attachment-chip"><FileTypeIcon mimeType={attachment.mime_type} /><span>{attachment.display_name}</span><button type="button" onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))} aria-label={`Remove ${attachment.display_name}`} title="Remove attachment"><X size={12} /></button></span>)}</div>}
          <label className="agentic-super-app-visually-hidden" htmlFor="agentic-super-app-chat-draft">Message</label>
          <textarea id="agentic-super-app-chat-draft" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!activeTurn) void sendMessage() } }} placeholder="Message the assistant…" rows={3} disabled={busy === 'send'} />
          <div className="agentic-super-app-chat-composer-toolbar">
            <div className="agentic-super-app-chat-composer-controls"><button className="agentic-super-app-icon-button" type="button" onClick={() => void importAttachments()} disabled={busy !== null || Boolean(activeTurn)} aria-label="Attach files" title="Attach PDF, image, or text file"><Paperclip size={17} /></button><select aria-label="Provider" value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={Boolean(activeTurn)}>{snapshot.providers.length ? snapshot.providers.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>) : <option value={providerFallback}>OpenAI Responses</option>}</select><input aria-label="Model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model" disabled={Boolean(activeTurn)} /><select aria-label="Reasoning effort" value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as ChatReasoningEffort)} disabled={Boolean(activeTurn)}>{reasoningOptions.map((option) => <option key={option.value} value={option.value}>{option.label} reasoning</option>)}</select></div>
            <div className="agentic-super-app-chat-composer-submit"><span className="agentic-super-app-composer-hint">Ctrl/⌘ + Enter</span>{activeTurn ? <button className="is-stop" type="submit" disabled={busy === 'stop'}><Square size={15} />{busy === 'stop' ? 'Stopping…' : 'Stop'}</button> : <button type="submit" disabled={busy !== null || (!draft.trim() && !attachments.length)}><Send size={15} />Send</button>}</div>
          </div>
        </form>
      </> : <div className="agentic-super-app-chat-no-selection"><MessageGlyph /><h2>Select a conversation</h2><button type="button" onClick={createConversation}><Plus size={15} />New chat</button></div>}
    </section>
  </section>
}

function ChatMessageView({ message, turn, onEdit, onBranch, onRetry }: { message: ChatMessage; turn?: ChatTurnSummary; onEdit?: () => void; onBranch: () => void; onRetry?: () => void }) {
  const isUser = message.role === 'user'
  return <article className={`agentic-super-app-chat-message ${isUser ? 'is-user' : 'is-assistant'}`}><div className="agentic-super-app-chat-message-avatar" aria-hidden="true">{isUser ? <span>Y</span> : <Bot size={16} />}</div><div className="agentic-super-app-chat-message-body"><div className="agentic-super-app-chat-message-meta"><span>{isUser ? 'You' : 'Assistant'}</span><time dateTime={new Date(message.created_at_unix_ms).toISOString()}>{formatTime(message.created_at_unix_ms)}</time>{turn && <span className={`agentic-super-app-chat-turn-state ${turn.state}`}>{turn.state.replaceAll('_', ' ')}</span>}</div><div className="agentic-super-app-chat-message-content">{message.parts.map((part, index) => <ChatPartView key={`${message.id}-${part.kind}-${index}`} part={part} />)}</div><div className="agentic-super-app-chat-message-actions"><button type="button" onClick={onEdit} disabled={!onEdit} aria-label="Edit message" title="Edit message"><Edit3 size={13} /></button><button type="button" onClick={onBranch} aria-label="Branch from message" title="Branch from message"><GitBranch size={13} /></button>{onRetry && <button type="button" onClick={onRetry} aria-label="Retry response" title="Retry response"><RefreshCw size={13} /></button>}<button type="button" onClick={() => void navigator.clipboard?.writeText(messageText(message))} aria-label="Copy message" title="Copy message"><Copy size={13} /></button></div></div></article>
}

function ChatPartView({ part }: { part: ChatMessagePart }) {
  switch (part.kind) {
    case 'text': return <p className="agentic-super-app-chat-text">{part.text.split('\n').map((line, index) => <span key={`${line}-${index}`}>{line}{index < part.text.split('\n').length - 1 && <br />}</span>)}</p>
    case 'reasoning_summary': return <details className="agentic-super-app-chat-reasoning"><summary><ChevronDown size={14} />Reasoning summary</summary><p>{part.text}</p></details>
    case 'status': return <div className="agentic-super-app-chat-part-status"><span>{part.code.replaceAll('_', ' ')}</span>{part.text}</div>
    case 'error': return <div className="agentic-super-app-chat-part-error"><strong>{part.code.replaceAll('_', ' ')}</strong><span>{part.message}</span></div>
    case 'attachment': return <AttachmentCard attachment={part.attachment} />
    case 'image': return <AttachmentCard attachment={part.attachment} image />
    case 'citation': return <a className="agentic-super-app-chat-citation" href={part.url} target="_blank" rel="noreferrer">{part.title || part.url}<ArrowUp size={13} /></a>
    case 'usage': return <span className="agentic-super-app-chat-usage">{part.input_tokens ?? '—'} in · {part.output_tokens ?? '—'} out tokens</span>
    case 'tool_call': return <div className="agentic-super-app-chat-tool-part"><MoreHorizontal size={14} /><span>Tool call reserved: {part.name}</span></div>
    case 'tool_result': return <div className="agentic-super-app-chat-tool-part"><MoreHorizontal size={14} /><span>Tool result reserved for {part.call_id}</span></div>
  }
}

function AttachmentCard({ attachment, image = false }: { attachment: ChatAttachmentSummary; image?: boolean }) {
  return <div className="agentic-super-app-chat-attachment-card">{image ? <ImageIcon size={18} /> : <FileText size={18} />}<span><strong>{attachment.display_name}</strong><small>{formatBytes(attachment.bytes)} · {attachment.mime_type}</small></span></div>
}

function FileTypeIcon({ mimeType }: { mimeType: string }) { return mimeType.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} /> }
function MessageGlyph() { return <Bot size={28} /> }
function messageText(message: ChatMessage) { return message.parts.filter((part): part is Extract<ChatMessagePart, { kind: 'text' }> => part.kind === 'text').map((part) => part.text).join('\n') }
function partTextLength(part: ChatMessagePart) { if (part.kind === 'text' || part.kind === 'reasoning_summary' || part.kind === 'status') return part.text.length; if (part.kind === 'error') return part.message.length; return 0 }
function formatBytes(bytes: number) { if (!bytes) return 'Pending size'; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB` }
function formatTime(timestamp: number) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp) }
function relativeTime(timestamp: number) { const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000)); if (minutes < 1) return 'now'; if (minutes < 60) return `${minutes}m`; const hours = Math.round(minutes / 60); if (hours < 24) return `${hours}h`; return `${Math.round(hours / 24)}d` }
