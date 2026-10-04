import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, Folder, Gauge, Lock, RefreshCw, Search, ShieldCheck, Square } from 'lucide-react'
import type { ChatModel, ChatSession } from '@shared/domain/chat'
import { CliLogo } from '../../components/cli/CliLogo'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { Popover } from '../../components/ui/Popover'
import { cx } from '../../lib/cx'
import { useChat } from '../../stores/chat'
import { useClis, useProjects } from '../../stores/data'
import styles from './Chat.module.css'

const MAX_VISIBLE_MODELS = 250

/** Message box plus the CLI → model → effort pickers. Effort appears only when the chosen model supports it. */
export function ChatComposer({ chat }: { chat: ChatSession & { running: boolean } }) {
  const { send, stop, update, clis: chatClis, catalogs, loadCatalog } = useChat()
  const clis = useClis((s) => s.clis)
  const projects = useProjects((s) => s.projects)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const locked = chat.messages.length > 0
  const catalog = chat.cliId ? catalogs[chat.cliId] : undefined
  const models = catalog && catalog !== 'loading' ? catalog.models : []
  const model: ChatModel | undefined = models.find((m) => m.id === (chat.model ?? ''))
  const efforts = model?.efforts ?? []

  useEffect(() => {
    if (chat.cliId) void loadCatalog(chat.cliId)
  }, [chat.cliId, loadCatalog])

  // Auto-pick the only available CLI so a new chat is one step shorter.
  useEffect(() => {
    if (!chat.cliId && !locked && chatClis.length === 1) void update({ cliId: chatClis[0] })
  }, [chat.cliId, locked, chatClis, update])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!value || chat.running || !chat.cliId) return
    setText('')
    const ok = await send(value)
    if (!ok) setText(value)
  }

  const cliItems = chatClis.map((id) => {
    const cli = clis.find((c) => c.id === id)
    return {
      type: 'item' as const,
      id,
      label: cli?.displayName ?? id,
      icon: <CliLogo cliId={id} size="sm" />,
      checked: chat.cliId === id,
      onSelect: () => void update({ cliId: id })
    }
  })

  return (
    <div className={styles.composerWrap}>
      <div className={styles.composer}>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          placeholder={chat.cliId ? 'Message — Enter to send, Shift+Enter for a new line' : 'Choose a CLI below to start'}
          value={text}
          disabled={!chat.cliId}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          aria-label="Message"
        />
        <div className={styles.controls}>
          {locked && chat.cliId ? (
            <span className={styles.lockedCli} title="The CLI is fixed for this chat">
              <CliLogo cliId={chat.cliId} size="sm" />
              {clis.find((c) => c.id === chat.cliId)?.displayName}
              <Lock aria-label="Locked" />
            </span>
          ) : (
            <Menu
              label="Choose CLI"
              items={cliItems}
              empty="No chat-capable CLI is installed."
              trigger={(props) => (
                <button type="button" {...props} className={styles.picker}>
                  {chat.cliId ? <CliLogo cliId={chat.cliId} size="sm" /> : null}
                  {chat.cliId ? clis.find((c) => c.id === chat.cliId)?.displayName : 'Choose CLI'}
                  <ChevronDown aria-hidden />
                </button>
              )}
            />
          )}

          {chat.cliId && (
            <ModelPicker
              models={models}
              loading={catalog === 'loading'}
              error={catalog && catalog !== 'loading' ? catalog.error : undefined}
              value={chat.model ?? ''}
              onRefresh={() => void loadCatalog(chat.cliId!, true)}
              onChange={(next) =>
                void update({ model: next.id, effort: next.efforts?.includes(chat.effort ?? '') ? chat.effort : '' })
              }
            />
          )}

          {efforts.length > 0 && (
            <Menu
              label="Effort"
              items={[
                { type: 'item', id: 'default', label: `Default${model?.defaultEffort ? ` (${model.defaultEffort})` : ''}`, checked: !chat.effort, onSelect: () => void update({ effort: '' }) },
                ...efforts.map((e) => ({ type: 'item' as const, id: e, label: e, checked: chat.effort === e, onSelect: () => void update({ effort: e }) }))
              ]}
              trigger={(props) => (
                <button type="button" {...props} className={styles.picker}>
                  <Gauge aria-hidden />
                  {chat.effort ?? 'Effort'}
                  <ChevronDown aria-hidden />
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
                <button type="button" {...props} className={styles.picker} title={chat.cwd}>
                  <Folder aria-hidden />
                  {projects.find((p) => p.id === chat.projectId)?.name ?? 'Home folder'}
                  <ChevronDown aria-hidden />
                </button>
              )}
            />
          )}

          <span className={styles.flex} />
          <IconButton
            label={chat.autoApprove ? 'Auto-approve is on' : 'Auto-approve is off'}
            icon={<ShieldCheck />}
            active={chat.autoApprove}
            onClick={() => void update({ autoApprove: !chat.autoApprove })}
          />
          {chat.running ? (
            <button type="button" className={styles.send} onClick={() => void stop()} aria-label="Stop">
              <Square aria-hidden />
            </button>
          ) : (
            <button type="button" className={styles.send} onClick={() => void submit()} disabled={!text.trim() || !chat.cliId} aria-label="Send">
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
        <button type="button" {...props} className={styles.picker} title={current?.id || 'Default model'}>
          {loading ? 'Loading models…' : (current?.label ?? 'Default')}
          <ChevronDown aria-hidden />
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
