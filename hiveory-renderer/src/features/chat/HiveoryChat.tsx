import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import {
  AlertCircle,
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  File,
  FilePlus2,
  Folder,
  FolderInput,
  FolderPlus,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  MessageCircle,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import {
  hiveoryClient,
  type ChatAttachmentBytesRequest,
  type ChatAttachmentSummary,
  type ChatConversationDetail,
  type ChatConversationSummary,
  type ChatEngineCatalog,
  type ChatEngineSummary,
  type ChatFolderSummary,
  type ChatMessage,
  type ChatMessagePart,
  type ChatReasoningEffort,
  type ChatSidebarPage,
} from '../../shared/api/hiveory-client'
import { CliBrandIcon } from '../workspace/CliIcons'
import { ChatMarkdown } from './ChatMarkdown'

type PendingAttachment = {
  key: string
  name: string
  path?: string
  dataBase64?: string
  mimeType?: string
}

type BusyAction = 'send' | 'retry' | 'edit' | 'branch' | 'delete' | null

const EMPTY_SIDEBAR: ChatSidebarPage = { conversations: [], folders: [], next_cursor: null }

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value)
}

function pathName(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || value
}

function modelLabel(engine: ChatEngineSummary | undefined, modelId: string): string {
  return engine?.models.find((model) => model.id === modelId)?.display_name ?? modelId
}

function textFromMessage(message: ChatMessage): string {
  return message.parts.filter((part): part is Extract<ChatMessagePart, { kind: 'text' }> => part.kind === 'text').map((part) => part.text).join('')
}

function encodeBinary(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function mimeFromName(value: string): string {
  const extension = value.split('.').pop()?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'pdf') return 'application/pdf'
  return 'text/plain'
}

function titleFromPrompt(value: string): string {
  const firstLine = value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? 'New chat'
  return firstLine.replace(/^#+\s*/, '').slice(0, 68) || 'New chat'
}

function effortLabel(value: ChatReasoningEffort): string {
  return value === 'xhigh' ? 'Extra high' : value.charAt(0).toUpperCase() + value.slice(1)
}

function statusLabel(value: ChatEngineSummary['availability']): string {
  if (value === 'missing') return 'Not installed'
  if (value === 'unauthenticated') return 'Not configured'
  if (value === 'unavailable') return 'Unavailable'
  return 'Ready'
}

export function HiveoryChat() {
  const [sidebar, setSidebar] = useState<ChatSidebarPage>(EMPTY_SIDEBAR)
  const [sidebarLoading, setSidebarLoading] = useState(true)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [folderFilter, setFolderFilter] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<ChatConversationDetail | null>(null)
  const [conversationLoading, setConversationLoading] = useState(false)
  const [engineCatalog, setEngineCatalog] = useState<ChatEngineCatalog | null>(null)
  const [engineLoading, setEngineLoading] = useState(true)
  const [selectedEngineId, setSelectedEngineId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('default')
  const [selectedEffort, setSelectedEffort] = useState<ChatReasoningEffort>('auto')
  const [engineMenuOpen, setEngineMenuOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftDirty, setDraftDirty] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)
  const enginePickerRef = useRef<HTMLDivElement>(null)
  const detailRequestRef = useRef(0)

  const selectedEngine = engineCatalog?.engines.find((engine) => engine.id === selectedEngineId)
  const selectedModel = selectedEngine?.models.find((model) => model.id === selectedModelId)
  const activeTurn = conversation?.turns.find((turn) => ['queued', 'streaming', 'cancel_requested'].includes(turn.state))
  const turnById = useMemo(() => new Map((conversation?.turns ?? []).map((turn) => [turn.id, turn])), [conversation?.turns])

  const reloadSidebar = useCallback(async () => {
    setSidebarLoading(true)
    try {
      const next = await hiveoryClient.chatSidebar({ search: sidebarSearch.trim() || undefined, archived: showArchived, folder_id: folderFilter, limit: 100 })
      setSidebar(next)
      if (selectedId && !next.conversations.some((item) => item.id === selectedId)) {
        setSelectedId(null)
        setConversation(null)
      } else if (!selectedId && next.conversations.length) {
        setSelectedId(next.conversations[0].id)
      }
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'Chat history could not be loaded.'))
    } finally {
      setSidebarLoading(false)
    }
  }, [folderFilter, selectedId, showArchived, sidebarSearch])

  const reloadEngines = useCallback(async () => {
    setEngineLoading(true)
    try {
      setEngineCatalog(await hiveoryClient.chatEngines())
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'Chat engines could not be discovered.'))
    } finally {
      setEngineLoading(false)
    }
  }, [])

  const reloadConversation = useCallback(async (conversationId: string) => {
    const request = detailRequestRef.current + 1
    detailRequestRef.current = request
    setConversationLoading(true)
    try {
      const next = await hiveoryClient.chatConversation(conversationId)
      if (request !== detailRequestRef.current) return
      setConversation(next)
      setDraft(next.draft)
      setDraftDirty(false)
      setTitleDraft(next.title)
    } catch (reason: unknown) {
      if (request === detailRequestRef.current) setError(errorMessage(reason, 'The conversation could not be opened.'))
    } finally {
      if (request === detailRequestRef.current) setConversationLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void reloadSidebar(), 120)
    return () => window.clearTimeout(timer)
  }, [reloadSidebar])

  useEffect(() => {
    void reloadEngines()
  }, [reloadEngines])

  useEffect(() => {
    if (!selectedId) {
      setConversation(null)
      setDraft('')
      setDraftDirty(false)
      setTitleDraft('New chat')
      return
    }
    void reloadConversation(selectedId)
  }, [reloadConversation, selectedId])

  useEffect(() => {
    if (!engineCatalog) return
    const current = engineCatalog.engines.find((engine) => engine.id === selectedEngineId)
    if (!current) {
      const ready = engineCatalog.engines.find((engine) => engine.availability === 'ready')
      setSelectedEngineId(ready?.id ?? engineCatalog.engines[0]?.id ?? '')
    }
  }, [engineCatalog, selectedEngineId])

  useEffect(() => {
    const models = selectedEngine?.models ?? []
    if (!models.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(models[0]?.id ?? 'default')
      setSelectedEffort(models[0]?.default_effort ?? 'auto')
      return
    }
    if (selectedModel && !selectedModel.effort_levels.includes(selectedEffort)) setSelectedEffort(selectedModel.default_effort)
  }, [selectedEngine, selectedModel, selectedModelId, selectedEffort])

  useEffect(() => {
    if (!draftDirty || !conversation) return
    const timer = window.setTimeout(() => {
      void hiveoryClient.saveChatDraft(conversation.id, draft).catch((reason: unknown) => setError(errorMessage(reason, 'The draft could not be saved.')))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [conversation, draft, draftDirty])

  useEffect(() => {
    const unsubscribe = hiveoryClient.subscribeChat((event) => {
      if (!selectedId || event.conversation_id !== selectedId) return
      window.setTimeout(() => void reloadConversation(selectedId), 80)
    })
    return unsubscribe
  }, [reloadConversation, selectedId])

  useEffect(() => {
    if (!engineMenuOpen) return
    const close = (event: MouseEvent) => {
      if (!enginePickerRef.current?.contains(event.target as Node)) setEngineMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [engineMenuOpen])

  const lastMessageParts = conversation?.messages.at(-1)?.parts

  useEffect(() => {
    const node = transcriptRef.current
    if (!node) return
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 180
    if (nearBottom) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [conversation?.messages.length, lastMessageParts])

  const setSelectedEngine = (engine: ChatEngineSummary) => {
    if (engine.availability !== 'ready') {
      setStatusMessage(engine.message ?? `${engine.display_name} is not ready.`)
      return
    }
    setSelectedEngineId(engine.id)
    setEngineMenuOpen(false)
    setStatusMessage(null)
  }

  const addPendingPaths = (paths: string[]) => {
    setPendingAttachments((current) => {
      const known = new Set(current.filter((item) => item.path).map((item) => item.path))
      const additions = paths.filter((path) => path && !known.has(path)).map((path) => ({ key: `path-${path}-${Date.now()}`, name: pathName(path), path, mimeType: mimeFromName(path) }))
      return [...current, ...additions]
    })
  }

  const addPendingFile = async (file: File) => {
    const fileWithPath = file as File & { path?: string }
    if (fileWithPath.path) {
      addPendingPaths([fileWithPath.path])
      return
    }
    const dataBase64 = encodeBinary(await file.arrayBuffer())
    setPendingAttachments((current) => [...current, { key: `file-${file.name}-${Date.now()}`, name: file.name || 'attachment', dataBase64, mimeType: file.type || mimeFromName(file.name) }])
  }

  const chooseFiles = async () => {
    try {
      addPendingPaths(await hiveoryClient.chooseAttachmentPaths())
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'Files could not be selected.'))
    }
  }

  const chooseFolder = async () => {
    try {
      const path = await hiveoryClient.chooseAttachmentFolderPath()
      if (path) addPendingPaths([path])
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The folder could not be selected.'))
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const image = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'))
    if (!image) return
    const file = image.getAsFile()
    if (!file) return
    event.preventDefault()
    void addPendingFile(file)
    setStatusMessage('Screenshot added to this message.')
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    if (files.length) void Promise.all(files.map((file) => addPendingFile(file)))
    else {
      const text = event.dataTransfer.getData('text/plain')
      if (text) addPendingPaths([text])
    }
  }

  const createNewChat = () => {
    setSelectedId(null)
    setConversation(null)
    setDraft('')
    setDraftDirty(false)
    setPendingAttachments([])
    setError(null)
    setStatusMessage(null)
    setRowMenuId(null)
    setFolderMenuId(null)
  }

  const createFolder = async () => {
    const name = window.prompt('Folder name')?.trim()
    if (!name) return
    try {
      await hiveoryClient.createChatFolder(name)
      await reloadSidebar()
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The folder could not be created.'))
    }
  }

  const renameFolder = async (folder: ChatFolderSummary) => {
    const name = window.prompt('Rename folder', folder.name)?.trim()
    if (!name || name === folder.name) return
    try {
      await hiveoryClient.updateChatFolder({ folder_id: folder.id, name, position: null })
      await reloadSidebar()
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The folder could not be renamed.'))
    }
  }

  const deleteFolder = async (folder: ChatFolderSummary) => {
    if (!window.confirm(`Delete “${folder.name}”? Chats will remain outside folders.`)) return
    try {
      await hiveoryClient.deleteChatFolder(folder.id)
      if (folderFilter === folder.id) setFolderFilter(null)
      await reloadSidebar()
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The folder could not be deleted.'))
    }
  }

  const moveConversation = async (conversationId: string, targetFolderId: string | null) => {
    try {
      await hiveoryClient.moveChatToFolder({ conversation_id: conversationId, folder_id: targetFolderId, position: null })
      setRowMenuId(null)
      await reloadSidebar()
      if (conversation?.id === conversationId) await reloadConversation(conversationId)
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The chat could not be moved.'))
    }
  }

  const updateConversation = async (conversationId: string, payload: { pinned?: boolean | null; archived?: boolean | null }) => {
    try {
      const next = await hiveoryClient.updateChat({ conversation_id: conversationId, ...payload })
      if (conversation?.id === conversationId) setConversation(next)
      setRowMenuId(null)
      await reloadSidebar()
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The chat could not be updated.'))
    }
  }

  const deleteConversation = async (item: ChatConversationSummary) => {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return
    setBusyAction('delete')
    try {
      await hiveoryClient.deleteChat(item.id)
      if (selectedId === item.id) createNewChat()
      await reloadSidebar()
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The chat could not be deleted.'))
    } finally {
      setBusyAction(null)
      setRowMenuId(null)
    }
  }

  const saveTitle = async () => {
    if (!conversation) return
    const nextTitle = titleDraft.trim() || 'New chat'
    if (nextTitle === conversation.title) return
    try {
      const next = await hiveoryClient.updateChat({ conversation_id: conversation.id, title: nextTitle })
      setConversation(next)
      await reloadSidebar()
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The chat title could not be saved.'))
    }
  }

  const importPending = async (conversationId: string): Promise<ChatAttachmentSummary[]> => {
    const imported: ChatAttachmentSummary[] = []
    const paths = pendingAttachments.flatMap((item) => item.path ? [item.path] : [])
    if (paths.length) imported.push(...await hiveoryClient.importChatAttachments({ conversation_id: conversationId, message_id: null, paths }))
    for (const item of pendingAttachments.filter((candidate) => candidate.dataBase64)) {
      const request: ChatAttachmentBytesRequest = { conversation_id: conversationId, message_id: null, display_name: item.name, mime_type: item.mimeType ?? mimeFromName(item.name), data_base64: item.dataBase64 ?? '' }
      imported.push(await hiveoryClient.importChatAttachmentBytes(request))
    }
    return imported
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (busyAction || (!text && !pendingAttachments.length)) return
    if (!selectedEngine || selectedEngine.availability !== 'ready') {
      setError(selectedEngine?.message ?? 'Choose a ready chat engine before sending.')
      return
    }
    setBusyAction('send')
    setError(null)
    setStatusMessage(null)
    const imported: ChatAttachmentSummary[] = []
    let targetConversationId = ''
    try {
      let target = conversation
      if (!target) {
        target = await hiveoryClient.createChat()
        setSelectedId(target.id)
        setConversation(target)
      }
      targetConversationId = target.id
      imported.push(...await importPending(target.id))
      const next = await hiveoryClient.startChatTurn({
        conversation_id: target.id,
        branch_id: target.active_branch_id,
        text,
        attachment_ids: imported.map((item) => item.id),
        provider_account_id: selectedEngine.id,
        model: selectedModelId || 'default',
        reasoning_effort: selectedEffort,
      })
      setConversation(next)
      setDraft('')
      setDraftDirty(false)
      setPendingAttachments([])
      if (target.title === 'New chat' && text) {
        const titled = await hiveoryClient.updateChat({ conversation_id: target.id, title: titleFromPrompt(text) })
        setConversation(titled)
      }
      await reloadSidebar()
    } catch (reason: unknown) {
      if (targetConversationId) await Promise.all(imported.map((item) => hiveoryClient.discardChatAttachment({ conversation_id: targetConversationId, attachment_id: item.id }).catch(() => false)))
      setError(errorMessage(reason, 'The message could not be sent.'))
    } finally {
      setBusyAction(null)
    }
  }

  const stopTurn = async () => {
    if (!conversation || !activeTurn) return
    try {
      await hiveoryClient.cancelChatTurn({ conversation_id: conversation.id, turn_id: activeTurn.id, model: null, reasoning_effort: null })
      setStatusMessage('Stopping the response…')
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The response could not be stopped.'))
    }
  }

  const retryTurn = async (turnId: string) => {
    if (!conversation || busyAction) return
    const turn = turnById.get(turnId)
    if (!turn) return
    setBusyAction('retry')
    try {
      setConversation(await hiveoryClient.retryChatTurn({ conversation_id: conversation.id, turn_id: turn.id, model: turn.model || null, reasoning_effort: turn.reasoning_effort }))
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The response could not be retried.'))
    } finally {
      setBusyAction(null)
    }
  }

  const branchFromMessage = async (messageId: string) => {
    if (!conversation || busyAction) return
    setBusyAction('branch')
    try {
      const next = await hiveoryClient.branchChat({ conversation_id: conversation.id, message_id: messageId })
      setConversation(next)
      await reloadSidebar()
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'A new branch could not be created.'))
    } finally {
      setBusyAction(null)
    }
  }

  const submitEdit = async () => {
    if (!conversation || !editingMessageId || !editingText.trim() || busyAction || !selectedEngine) return
    setBusyAction('edit')
    try {
      setConversation(await hiveoryClient.editChatMessage({ conversation_id: conversation.id, message_id: editingMessageId, text: editingText.trim(), provider_account_id: selectedEngine.id, model: selectedModelId || 'default', reasoning_effort: selectedEffort }))
      setEditingMessageId(null)
      setEditingText('')
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The message could not be edited.'))
    } finally {
      setBusyAction(null)
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const renderConversationRow = (item: ChatConversationSummary) => (
    <div
      key={item.id}
      className="hiveory-chat-list-row"
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/chat-id', item.id)}
    >
      <button type="button" className={`hiveory-chat-list-item${item.id === selectedId ? ' is-selected' : ''}`} onClick={() => { setSelectedId(item.id); setRowMenuId(null) }}>
        <span className="hiveory-chat-list-title">{item.pinned && <Pin size={11} aria-label="Pinned" />} {item.title}</span>
        <span className="hiveory-chat-list-preview">{item.preview ?? 'No messages yet'}</span>
        <span className="hiveory-chat-list-meta">{formatDate(item.updated_at_unix_ms)}</span>
      </button>
      <button type="button" className="hiveory-icon-button hiveory-chat-row-menu-button" aria-label={`Actions for ${item.title}`} aria-expanded={rowMenuId === item.id} onClick={(event) => { event.stopPropagation(); setRowMenuId(rowMenuId === item.id ? null : item.id); setFolderMenuId(null) }}>
        <Ellipsis size={15} />
      </button>
      {rowMenuId === item.id && (
        <div className="hiveory-chat-row-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => void updateConversation(item.id, { pinned: !item.pinned })}>{item.pinned ? <PinOff size={14} /> : <Pin size={14} />}{item.pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" role="menuitem" onClick={() => void updateConversation(item.id, { archived: !item.archived })}><Archive size={14} />{item.archived ? 'Restore' : 'Archive'}</button>
          <div className="hiveory-chat-menu-label"><FolderInput size={14} />Move to</div>
          {sidebar.folders.map((folder) => <button key={folder.id} type="button" role="menuitem" onClick={() => void moveConversation(item.id, folder.id)}><Folder size={13} />{folder.name}</button>)}
          {item.folder_id && <button type="button" role="menuitem" onClick={() => void moveConversation(item.id, null)}><X size={14} />Remove from folder</button>}
          <button type="button" role="menuitem" className="is-danger" disabled={busyAction === 'delete'} onClick={() => void deleteConversation(item)}><Trash2 size={14} />Delete</button>
        </div>
      )}
    </div>
  )

  const renderFolder = (folder: ChatFolderSummary) => {
    const items = sidebar.conversations.filter((item) => item.folder_id === folder.id)
    return (
      <section key={folder.id} className="hiveory-chat-folder-section" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const chatId = event.dataTransfer.getData('text/chat-id'); if (chatId) void moveConversation(chatId, folder.id) }}>
        <div className={`hiveory-chat-folder-row${folderFilter === folder.id ? ' is-selected' : ''}`}>
          <button type="button" onClick={() => { setFolderFilter(folderFilter === folder.id ? null : folder.id); setSelectedId(null) }}><Folder size={14} /><span>{folder.name}</span><small>{folder.conversation_count}</small></button>
          <button type="button" className="hiveory-icon-button" aria-label={`Actions for ${folder.name}`} onClick={() => { setFolderMenuId(folderMenuId === folder.id ? null : folder.id); setRowMenuId(null) }}><Ellipsis size={14} /></button>
          {folderMenuId === folder.id && <div className="hiveory-chat-folder-menu" role="menu"><button type="button" role="menuitem" onClick={() => void renameFolder(folder)}>Rename</button><button type="button" role="menuitem" className="is-danger" onClick={() => void deleteFolder(folder)}>Delete folder</button></div>}
        </div>
        {items.map(renderConversationRow)}
      </section>
    )
  }

  const renderMessage = (message: ChatMessage) => {
    const turn = message.turn_id ? turnById.get(message.turn_id) : undefined
    const text = textFromMessage(message)
    const reasoning = message.parts.filter((part): part is Extract<ChatMessagePart, { kind: 'reasoning_summary' }> => part.kind === 'reasoning_summary').map((part) => part.text).join('\n')
    const isUser = message.role === 'user'
    const engine = engineCatalog?.engines.find((candidate) => candidate.id === turn?.provider_account_id)
    return (
      <article key={message.id} className={`hiveory-chat-message${isUser ? ' is-user' : ''}`}>
        <div className="hiveory-chat-message-avatar" aria-hidden="true">{isUser ? 'You' : <MessageCircle size={15} />}</div>
        <div className="hiveory-chat-message-body">
          <div className="hiveory-chat-message-meta"><span>{isUser ? 'You' : 'Assistant'}</span>{turn && <><span className="hiveory-chat-turn-engine">{engine?.display_name ?? turn.provider_account_id} · {modelLabel(engine, turn.model)}</span><span className={`hiveory-chat-turn-state ${turn.state}`}>{turn.state.replaceAll('_', ' ')}</span></>}<time>{formatDate(message.created_at_unix_ms)}</time></div>
          {reasoning && <details className="hiveory-chat-reasoning"><summary><ChevronRight size={14} />Reasoning summary</summary><p>{reasoning}</p></details>}
          <div className="hiveory-chat-message-content">
            {text && (isUser ? <p className="hiveory-chat-text">{text}</p> : <ChatMarkdown text={text} />)}
            {!text && turn?.state === 'streaming' && <span className="hiveory-chat-streaming-status"><span className="hiveory-pulse" />Generating response<span className="hiveory-dot-loader">···</span></span>}
            {message.parts.filter((part) => part.kind !== 'text' && part.kind !== 'reasoning_summary').map((part, index) => <MessagePartView key={`${message.id}-part-${index}`} part={part} onDelete={isUser && conversation ? async (attachmentId) => { await hiveoryClient.deleteChatAttachment({ conversation_id: conversation.id, message_id: message.id, attachment_id: attachmentId }); await reloadConversation(conversation.id) } : undefined} />)}
          </div>
          <div className="hiveory-chat-message-actions">
            {text && <button type="button" aria-label="Copy message" title="Copy message" onClick={() => void navigator.clipboard?.writeText(text)}><Copy size={14} /></button>}
            {isUser && <button type="button" aria-label="Edit message" title="Edit message" onClick={() => { setEditingMessageId(message.id); setEditingText(text) }}><Settings2 size={14} /></button>}
            {turn && !isUser && <button type="button" aria-label="Retry response" title="Retry response" disabled={busyAction !== null || turn.state === 'streaming'} onClick={() => void retryTurn(turn.id)}><RotateCcw size={14} /></button>}
            <button type="button" aria-label="Create branch here" title="Create branch here" disabled={busyAction !== null} onClick={() => void branchFromMessage(message.id)}><Plus size={14} /></button>
          </div>
        </div>
      </article>
    )
  }

  const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => event.preventDefault()

  return (
    <div className="hiveory-chat" onClick={() => { setRowMenuId(null); setFolderMenuId(null) }}>
      <aside className="hiveory-chat-sidebar" aria-label="Chat history">
        <div className="hiveory-chat-sidebar-heading"><div><p className="hiveory-eyebrow">Workspace</p><h1>Chat</h1></div><button type="button" className="hiveory-icon-button" aria-label="Refresh chat data" title="Refresh chat data" onClick={() => { void reloadSidebar(); void reloadEngines() }}><RefreshCw size={15} /></button></div>
        <button type="button" className="hiveory-chat-new-button" onClick={createNewChat}><Plus size={15} />New chat</button>
        <label className="hiveory-search-field"><span className="hiveory-visually-hidden">Search chats</span><input value={sidebarSearch} onChange={(event) => setSidebarSearch(event.target.value)} placeholder="Search chats" /></label>
        <div className="hiveory-chat-filters" role="tablist" aria-label="Chat history filter"><button type="button" role="tab" aria-selected={!showArchived} className={!showArchived ? 'is-active' : ''} onClick={() => { setShowArchived(false); setSelectedId(null) }}>Recent</button><button type="button" role="tab" aria-selected={showArchived} className={showArchived ? 'is-active' : ''} onClick={() => { setShowArchived(true); setSelectedId(null) }}><Archive size={12} />Archived</button><button type="button" role="tab" aria-selected={folderFilter === null} className={folderFilter === null ? 'is-active' : ''} onClick={() => { setFolderFilter(null); setSelectedId(null) }}>All</button></div>
        <div className="hiveory-chat-sidebar-tools"><span>Folders</span><button type="button" className="hiveory-icon-button" aria-label="Create folder" title="Create folder" onClick={createFolder}><FolderPlus size={15} /></button></div>
        <div className="hiveory-chat-sidebar-scroll">
          <button type="button" className={`hiveory-chat-unfiled${folderFilter === null ? ' is-selected' : ''}`} onClick={() => { setFolderFilter(null); setSelectedId(null) }}><Folder size={14} />All conversations</button>
          {sidebar.folders.map(renderFolder)}
          <div className="hiveory-chat-sidebar-tools hiveory-chat-history-label"><span>{showArchived ? 'Archived chats' : 'Chats'}</span>{sidebarLoading && <LoaderCircle size={13} className="hiveory-chat-spin" />}</div>
          {sidebar.conversations.filter((item) => !item.folder_id).map(renderConversationRow)}
          {!sidebarLoading && !sidebar.conversations.length && <div className="hiveory-chat-list-empty"><MessageCircle size={22} /><p>{showArchived ? 'No archived chats.' : 'Your conversations will appear here after the first message.'}</p><button type="button" onClick={createNewChat}>Start a new chat</button></div>}
        </div>
        <div className="hiveory-chat-sidebar-footer"><Check size={13} />Standalone conversation · no workspace mounted</div>
      </aside>

      <main className="hiveory-chat-main">
        <header className="hiveory-chat-header">
          <div className="hiveory-chat-title-wrap"><MessageCircle size={17} /><div><input aria-label="Conversation title" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} /><p>Private chat · only explicitly attached context is sent</p></div></div>
          <div className="hiveory-chat-header-actions">{conversation?.pinned && <Pin size={14} aria-label="Pinned" />}<button type="button" className="hiveory-icon-button" aria-label="New chat" title="New chat" onClick={createNewChat}><Plus size={16} /></button>{conversation && <button type="button" className="hiveory-icon-button is-danger" aria-label="Delete conversation" title="Delete conversation" onClick={() => void deleteConversation({ id: conversation.id, title: conversation.title, active_branch_id: conversation.active_branch_id, pinned: conversation.pinned, archived: conversation.archived, folder_id: conversation.folder_id, folder_position: conversation.folder_position, updated_at_unix_ms: conversation.updated_at_unix_ms, preview: null })}><Trash2 size={15} /></button>}</div>
        </header>
        <div className="hiveory-chat-context-bar"><span><Check size={13} />No project or repository is mounted</span><span>Files, folders, and screenshots are opt-in</span>{conversation && conversation.branches.length > 1 && <span className="hiveory-branch-badge">{conversation.branches.length} branches</span>}</div>
        <div className="hiveory-chat-transcript" ref={transcriptRef} aria-live="polite">
          {conversationLoading && <div className="hiveory-chat-streaming-status"><LoaderCircle size={14} className="hiveory-chat-spin" />Opening conversation…</div>}
          {!conversation && !conversationLoading && <div className="hiveory-chat-empty"><span className="hiveory-empty-mark"><MessageCircle size={22} /></span><h2>Start a focused conversation</h2><p>Ask a question, compare answers across your installed CLIs, or attach only the files you want the active model to see.</p></div>}
          {conversation?.messages.map(renderMessage)}
          {activeTurn && <div className="hiveory-chat-streaming-status"><span className="hiveory-pulse" />{selectedEngine?.display_name ?? 'Engine'} is responding…</div>}
        </div>
        {error && <div className="hiveory-chat-status" role="alert"><AlertCircle size={14} />{error}<button type="button" className="hiveory-icon-button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={14} /></button></div>}
        {statusMessage && <div className="hiveory-chat-status" role="status">{statusMessage}</div>}
        {editingMessageId && <div className="hiveory-chat-edit"><div className="hiveory-chat-edit-heading"><span>Edit message</span><button type="button" className="hiveory-icon-button" aria-label="Cancel edit" onClick={() => setEditingMessageId(null)}><X size={14} /></button></div><textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} rows={4} /><div><button type="button" className="is-secondary" onClick={() => setEditingMessageId(null)}>Cancel</button><button type="button" disabled={!editingText.trim() || busyAction !== null} onClick={() => void submitEdit()}>Send edit</button></div></div>}
        <div className="hiveory-chat-composer" onDragOver={handleComposerDragOver} onDrop={handleDrop}>
          {pendingAttachments.length > 0 && <div className="hiveory-chat-attachments" aria-label="Pending attachments">{pendingAttachments.map((item) => <span className="hiveory-attachment-chip" key={item.key}><Paperclip size={12} /><span title={item.name}>{item.name}</span><button type="button" aria-label={`Remove ${item.name}`} onClick={() => setPendingAttachments((current) => current.filter((candidate) => candidate.key !== item.key))}><X size={12} /></button></span>)}</div>}
          <textarea aria-label="Message" placeholder="Ask anything…" value={draft} onChange={(event) => { setDraft(event.target.value); setDraftDirty(true) }} onKeyDown={onComposerKeyDown} onPaste={handlePaste} rows={3} />
          <div className="hiveory-chat-composer-toolbar">
            <div className="hiveory-chat-composer-controls">
              <button type="button" className="hiveory-icon-button" aria-label="Attach files" title="Attach files" onClick={() => void chooseFiles()}><FilePlus2 size={15} /></button>
              <button type="button" className="hiveory-icon-button" aria-label="Attach folder" title="Attach folder" onClick={() => void chooseFolder()}><FolderPlus size={15} /></button>
              <div className="hiveory-chat-engine-picker" ref={enginePickerRef}>
                <button type="button" className="hiveory-chat-select-button" aria-haspopup="listbox" aria-expanded={engineMenuOpen} onClick={(event) => { event.stopPropagation(); setEngineMenuOpen(!engineMenuOpen) }} disabled={engineLoading}><CliBrandIcon identifier={selectedEngine?.id} size={14} /><span>{selectedEngine?.display_name ?? (engineLoading ? 'Discovering engines…' : 'No engine')}</span><ChevronDown size={13} /></button>
                {engineMenuOpen && <div className="hiveory-chat-engine-menu" role="listbox" aria-label="Chat engines">{(engineCatalog?.engines ?? []).map((engine) => { const ready = engine.availability === 'ready'; return <button type="button" role="option" aria-selected={engine.id === selectedEngineId} aria-disabled={!ready} className={`hiveory-chat-engine-option ${engine.availability}`} title={ready ? `${engine.display_name} · ${engine.models.length} model${engine.models.length === 1 ? '' : 's'}` : `${statusLabel(engine.availability)}: ${engine.message ?? engine.recovery_action ?? 'Check this CLI configuration.'}`} onClick={(event) => { event.stopPropagation(); setSelectedEngine(engine) }}><CliBrandIcon identifier={engine.id} size={15} /><span><strong>{engine.display_name}</strong><small>{ready ? `${engine.models.length} models` : statusLabel(engine.availability)}</small></span>{ready ? engine.id === selectedEngineId && <Check size={14} /> : <AlertCircle size={14} aria-label={statusLabel(engine.availability)} />}</button> })}</div>}
              </div>
              <select aria-label="Chat model" value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)} disabled={!selectedEngine?.models.length}>{(selectedEngine?.models ?? []).map((model) => <option key={model.id} value={model.id}>{model.display_name}</option>)}</select>
              {selectedEngine?.capabilities.includes('reasoning_effort') && <select aria-label="Reasoning effort" value={selectedEffort} onChange={(event) => setSelectedEffort(event.target.value as ChatReasoningEffort)}>{(selectedModel?.effort_levels ?? ['auto']).map((effort) => <option key={effort} value={effort}>{effortLabel(effort)}</option>)}</select>}
              <span className="hiveory-composer-hint">Drop files or folders here · Shift+Enter for a new line</span>
            </div>
            <div className="hiveory-chat-composer-submit"><button type="button" className="hiveory-chat-mic-disabled" aria-disabled="true" title="Voice input is temporarily unavailable"><span className="hiveory-visually-hidden">Voice input temporarily unavailable</span><Mic size={15} /></button>{activeTurn ? <button type="button" className="is-stop" onClick={() => void stopTurn()}><Square size={13} />Stop</button> : <button type="button" disabled={busyAction !== null || (!draft.trim() && !pendingAttachments.length) || !selectedEngine || selectedEngine.availability !== 'ready'} onClick={() => void handleSend()}><Send size={14} />{busyAction === 'send' ? 'Sending…' : 'Send'}</button>}</div>
          </div>
        </div>
      </main>
    </div>
  )
}

function MessagePartView({ part, onDelete }: { part: ChatMessagePart; onDelete?: (attachmentId: string) => Promise<void> }) {
  switch (part.kind) {
    case 'status': return <div className="hiveory-chat-part-status"><span>{part.code.replaceAll('_', ' ')}</span>{part.text}</div>
    case 'error': return <div className="hiveory-chat-part-error"><strong>{part.code.replaceAll('_', ' ')}</strong><span>{part.message}</span></div>
    case 'attachment':
    case 'image': return <div className="hiveory-chat-attachment-card">{part.kind === 'image' ? <ImageIcon size={17} /> : <File size={17} />}<span><strong>{part.attachment.display_name}</strong><small>{part.attachment.mime_type} · {formatBytes(part.attachment.bytes)}</small></span>{onDelete && <button type="button" className="hiveory-icon-button" aria-label={`Remove ${part.attachment.display_name}`} onClick={() => void onDelete(part.attachment.id)}><X size={13} /></button>}</div>
    case 'citation': return <a className="hiveory-chat-citation" href={part.url} target="_blank" rel="noreferrer">{part.title ?? part.url}</a>
    case 'usage': return <small className="hiveory-chat-usage">{part.input_tokens ?? 0} input · {part.output_tokens ?? 0} output tokens</small>
    case 'tool_call': return <details className="hiveory-chat-tool-part"><summary>{part.name}</summary><pre>{part.arguments_json}</pre></details>
    case 'tool_result': return <details className="hiveory-chat-tool-part"><summary>Tool result</summary><pre>{part.result}</pre></details>
    default: return null
  }
}
