import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ArrowUp, Check, ChevronDown, Eye, FolderClosed, LockOpen, Paperclip, RefreshCw, Search, Square } from 'lucide-react'
import type { ChatModel, ChatSession } from '@shared/domain/chat'
import { CliLogo } from '../../components/cli/CliLogo'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { Popover } from '../../components/ui/Popover'
import { cx } from '../../lib/cx'
import { useChat } from '../../stores/chat'
import { useClis, useProjects } from '../../stores/data'
import { AttachmentChips } from './AttachmentChips'
import { EffortIcon } from './EffortIcon'
import { LONG_TEXT_CHARS, useAttachments } from './useAttachments'
import styles from './Chat.module.css'

const MAX_VISIBLE_MODELS = 250

interface ChatComposerProps {
  chat: ChatSession & { running: boolean }
  /**
   * Work agent in chat view: the CLI and folder belong to the agent, so only
   * model, effort and permissions are offered.
   */
  agent?: boolean
}

/**
 * Message box with attachments (paste or drop images, video, files and long
 * text) and the CLI → model → effort pickers. Effort appears only when the
 * chosen model supports it. Shared by Chat mode and Work agents in chat view.
 */
export function ChatComposer({ chat, agent = false }: ChatComposerProps) {
  const { send, stop, update: updateChat, clis: chatClis, catalogs, loadCatalog } = useChat()
  const clis = useClis((s) => s.clis)
  const projects = useProjects((s) => s.projects)
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const files = useAttachments(chat.id)
  const locked = agent || chat.messages.length > 0
  const catalog = chat.cliId ? catalogs[chat.cliId] : undefined
  const models = catalog && catalog !== 'loading' ? catalog.models : []
  const model: ChatModel | undefined = models.find((m) => m.id === (chat.model ?? ''))
  const efforts = model?.efforts ?? []
  const update = (patch: Parameters<typeof updateChat>[1]): Promise<void> => updateChat(chat.id, patch)
  const cliName = clis.find((c) => c.id === chat.cliId)?.displayName
  const canSend = Boolean(chat.cliId) && !chat.running && files.ready && (text.trim().length > 0 || files.attachments.length > 0)

  useEffect(() => {
    if (chat.cliId) void loadCatalog(chat.cliId)
  }, [chat.cliId, loadCatalog])

  // Auto-pick the only available CLI so a new chat is one step shorter.
  useEffect(() => {
    if (!chat.cliId && !locked && chatClis.length === 1) void updateChat(chat.id, { cliId: chatClis[0] })
  }, [chat.cliId, chat.id, locked, chatClis, updateChat])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    // Empty: one row. Measuring a wrapped placeholder (e.g. in a pane still being laid out) would freeze a tall box.
    if (text) el.style.height = `${Math.min(el.scrollHeight, 240)}px`
    el.style.overflowY = text && el.scrollHeight > 240 ? 'auto' : 'hidden'
  }, [text])

  const submit = async (): Promise<void> => {
    if (!canSend) return
    const value = text.trim()
    const attachments = files.attachments
    setText('')
    files.clear()
    const ok = await send(chat.id, value, attachments)
    if (!ok) setText(value)
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = [...event.clipboardData.files]
    if (pasted.length > 0) {
      event.preventDefault()
      files.addFiles(pasted)
      return
    }
    const value = event.clipboardData.getData('text/plain')
    if (value.length > LONG_TEXT_CHARS) {
      // Long text travels as a file: it stays readable here and never hits command-line limits.
      event.preventDefault()
      files.addText(value)
    }
  }

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length) files.addFiles([...event.dataTransfer.files])
  }

  const cliItems = chatClis.map((id) => ({
    type: 'item' as const,
    id,
    label: clis.find((c) => c.id === id)?.displayName ?? id,
    icon: <CliLogo cliId={id} size="sm" />,
    checked: chat.cliId === id,
    onSelect: () => void update({ cliId: id })
  }))

  return (
    <div className={cx(styles.composerWrap, agent && styles.composerWrapAgent)}>
      <div
        className={cx(styles.composer, dragging && styles.composerDrop)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <AttachmentChips
          items={files.items.map((item) => ({ ...item, pending: !item.attachment }))}
          onRemove={files.remove}
        />
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          placeholder={chat.cliId ? `Ask ${cliName ?? 'the agent'} anything…` : 'Choose a CLI below to start'}
          value={text}
          disabled={!chat.cliId}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          aria-label="Message"
        />
        <div className={styles.controls}>
          <IconButton
            label="Attach files"
            icon={<Paperclip />}
            size="md"
            disabled={!chat.cliId}
            onClick={() => fileRef.current?.click()}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              files.addFiles([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          {!agent &&
            (locked && chat.cliId ? (
              <span className={cx(styles.pill, styles.pillStatic)} title="The CLI is fixed once a chat has started">
                <CliLogo cliId={chat.cliId} size="sm" />
                <span className={styles.pillLabel}>{cliName}</span>
              </span>
            ) : (
              <Menu
                label="Choose CLI"
                items={cliItems}
                empty="No chat-capable CLI is installed."
                trigger={(props) => (
                  <button type="button" {...props} className={styles.pill}>
                    {chat.cliId && <CliLogo cliId={chat.cliId} size="sm" />}
                    <span className={styles.pillLabel}>{chat.cliId ? cliName : 'Choose CLI'}</span>
                    <ChevronDown aria-hidden className={styles.chevron} />
                  </button>
                )}
              />
            ))}
          {chat.cliId && (
            <ModelPicker
              models={models}
              loading={catalog === 'loading'}
              error={catalog && catalog !== 'loading' ? catalog.error : undefined}
              value={chat.model ?? ''}
              onRefresh={() => void loadCatalog(chat.cliId!, true)}
              onChange={(next) => void update({ model: next.id, effort: next.efforts?.includes(chat.effort ?? '') ? chat.effort : '' })}
            />
          )}
          {efforts.length > 0 && (
            <Menu
              label="Reasoning effort"
              items={[
                {
                  type: 'item',
                  id: 'default',
                  label: `Default${model?.defaultEffort ? ` (${model.defaultEffort})` : ''}`,
                  icon: <EffortIcon level={model?.defaultEffort} levels={efforts} />,
                  checked: !chat.effort,
                  onSelect: () => void update({ effort: '' })
                },
                ...efforts.map((e) => ({
                  type: 'item' as const,
                  id: e,
                  label: e[0]!.toUpperCase() + e.slice(1),
                  icon: <EffortIcon level={e} levels={efforts} />,
                  checked: chat.effort === e,
                  onSelect: () => void update({ effort: e })
                }))
              ]}
              trigger={(props) => (
                <button type="button" {...props} className={styles.pill} title="Reasoning effort">
                  <EffortIcon level={chat.effort ?? model?.defaultEffort} levels={efforts} />
                  <span className={cx(styles.pillLabel, styles.capitalize)}>{chat.effort ?? model?.defaultEffort ?? 'Effort'}</span>
                  <ChevronDown aria-hidden className={styles.chevron} />
                </button>
              )}
            />
          )}
          {!locked && (
            <Menu
              label="Folder"
              items={[
                { type: 'item', id: 'home', label: 'Home folder', checked: !chat.projectId, onSelect: () => void update({ projectId: '' }) },
                ...projects.map((p) => ({ type: 'item' as const, id: p.id, label: p.name, checked: chat.projectId === p.id, onSelect: () => void update({ projectId: p.id }) }))
              ]}
              trigger={(props) => (
                <button type="button" {...props} className={styles.pill} title={chat.cwd}>
                  <FolderClosed aria-hidden />
                  <span className={styles.pillLabel}>{projects.find((p) => p.id === chat.projectId)?.name ?? 'Home folder'}</span>
                  <ChevronDown aria-hidden className={styles.chevron} />
                </button>
              )}
            />
          )}
          <span className={styles.flex} />
          <Menu
            label="Permissions"
            align="end"
            items={[
              {
                type: 'item',
                id: 'read-only',
                label: 'Read-only',
                hint: 'Reads and answers',
                icon: <Eye />,
                checked: !chat.autoApprove,
                onSelect: () => void update({ autoApprove: false })
              },
              {
                type: 'item',
                id: 'full',
                label: 'Full access',
                hint: 'Edits files, runs commands',
                icon: <LockOpen />,
                checked: chat.autoApprove,
                onSelect: () => void update({ autoApprove: true })
              }
            ]}
            trigger={(props) => (
              <button
                type="button"
                {...props}
                className={styles.pill}
                title={chat.autoApprove ? 'Full access: the agent may edit files and run commands' : 'Read-only: the agent can read and answer, not change anything'}
              >
                {chat.autoApprove ? <LockOpen aria-hidden /> : <Eye aria-hidden />}
                <span className={styles.pillLabel}>{chat.autoApprove ? 'Full access' : 'Read-only'}</span>
              </button>
            )}
          />
          {chat.running ? (
            <button type="button" className={styles.send} onClick={() => void stop(chat.id)} aria-label="Stop">
              <Square aria-hidden />
            </button>
          ) : (
            <button type="button" className={styles.send} onClick={() => void submit()} disabled={!canSend} aria-label="Send">
              <ArrowUp aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface ModelPickerProps {
  models: ChatModel[]
  loading: boolean
  error?: string
  value: string
  onChange: (model: ChatModel) => void
  onRefresh: () => void
}

/** Searchable, grouped model list — built for CLIs like OpenCode with hundreds of models. */
function ModelPicker({ models, loading, error, value, onChange, onRefresh }: ModelPickerProps) {
  const [query, setQuery] = useState('')
  const current = models.find((m) => m.id === value)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? models.filter((m) => `${m.label} ${m.id} ${m.group ?? ''}`.toLowerCase().includes(q)) : models
    return list.slice(0, MAX_VISIBLE_MODELS)
  }, [models, query])
  const groups = useMemo(() => {
    const map = new Map<string, ChatModel[]>()
    for (const m of filtered) map.set(m.group ?? '', [...(map.get(m.group ?? '') ?? []), m])
    return [...map]
  }, [filtered])
  const total = query ? models.filter((m) => `${m.label} ${m.id} ${m.group ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())).length : models.length

  return (
    <Popover
      label="Choose model"
      placement="above"
      width="lg"
      trigger={(props) => (
        <button type="button" {...props} className={cx(styles.pill, styles.pillModel)} title={current?.id || 'Default model'}>
          <span className={styles.pillText}>{loading ? 'Loading models…' : (current?.label ?? 'Default model')}</span>
          <ChevronDown aria-hidden className={styles.chevron} />
        </button>
      )}
    >
      {(close) => (
        <div className={styles.models}>
          <div className={styles.modelSearch}>
            <Search aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${models.length} models`}
              aria-label="Search models"
            />
            <IconButton label="Refresh models" icon={<RefreshCw />} onClick={onRefresh} />
          </div>
          {error && <p className={styles.modelNote}>{error} The default model still works.</p>}
          <div className={styles.modelList} role="listbox" aria-label="Models">
            {groups.map(([group, list]) => (
              <div key={group || 'default'}>
                {group && <div className={styles.modelGroup}>{group}</div>}
                {list.map((m) => (
                  <button
                    key={m.id || 'default'}
                    type="button"
                    role="option"
                    aria-selected={m.id === value}
                    className={cx(styles.modelOption, m.id === value && styles.modelSelected)}
                    onClick={() => {
                      onChange(m)
                      close()
                    }}
                  >
                    <span className={styles.modelText}>
                      <span className={styles.modelLabel}>{m.label}</span>
                      <span className={styles.modelId}>{m.description ?? m.id}</span>
                    </span>
                    {m.efforts && m.efforts.length > 0 && <span className={styles.modelBadge}>effort</span>}
                    {m.id === value && <Check aria-hidden className={styles.modelCheck} />}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <p className={styles.modelNote}>No models match “{query}”.</p>}
            {total > filtered.length && <p className={styles.modelNote}>Showing {filtered.length} of {total} — refine your search.</p>}
          </div>
        </div>
      )}
    </Popover>
  )
}
