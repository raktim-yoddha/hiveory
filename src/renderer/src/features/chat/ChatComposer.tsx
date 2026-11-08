import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { AppWindow, ArrowUp, ChevronDown, Eye, ListPlus, ListTodo, LockOpen, Paperclip, Plus, Square, X, Zap } from 'lucide-react'
import type { ChatSession, ChatCommand } from '@shared/domain/chat'
import type { FileEntry } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { DRAFT_EVENT, rememberChatCli, takeChatDraft, useChat } from '../../stores/chat'
import { useClis } from '../../stores/data'
import { AttachmentChips } from './AttachmentChips'
import { ComposerTracks } from './ComposerTracks'
import { ContextMeter, latestUsage, WindowPicker } from './ComposerExtras'
import { EffortIcon } from './EffortIcon'
import { LONG_TEXT_CHARS, useAttachments } from './useAttachments'
import { focusChatInput } from './focus-input'
import { ModelPicker } from './ModelPicker'
import { applySuggestion, findTrigger, type Trigger } from './suggestions'
import { UsageLimitsButton } from './UsageLimitsButton'
import styles from './Chat.module.css'
import composer from './Composer.module.css'

const MAX_SUGGESTIONS = 8
const PLACEHOLDER = 'Message the agent, tag @files, or use /commands and /skills'
/** A quote picked in the conversation lands in the message box of that chat. */
export const QUOTE_EVENT = 'hiveory:quote'
const STASH_KEY = 'hiveory.promptStash'

interface ChatComposerProps {
  chat: ChatSession & { running: boolean }
  placeholder?: string
  /** The worktree it works in: `@` files, its changes and the agent's subagents (ADR 0058). */
  workspaceId?: string
  projectId?: string
}

type Suggestion = { key: string; value: string; label: string; detail?: string }

/** Saved drafts (Ctrl+S), per chat, kept in this window only. */
const readStash = (chatId: string): string[] => {
  try {
    const all = JSON.parse(localStorage.getItem(STASH_KEY) ?? '{}') as Record<string, string[]>
    return Array.isArray(all[chatId]) ? all[chatId] : []
  } catch {
    return []
  }
}
const writeStash = (chatId: string, list: string[]): void => {
  try {
    const all = JSON.parse(localStorage.getItem(STASH_KEY) ?? '{}') as Record<string, string[]>
    if (list.length) all[chatId] = list
    else delete all[chatId]
    localStorage.setItem(STASH_KEY, JSON.stringify(all))
  } catch {
    // Storage off: the draft just stays in the box.
  }
}

/**
 * A Work agent's message box in chat view (ADR 0058): its to-do list, subagents and the worktree's
 * changes above it; `@` tags files and `/` runs the CLI's commands and skills; attachments (paste,
 * drop, a picture of a window); the CLI and model in one picker, effort when the model has it,
 * permissions, fast and plan mode, and the context meter. ↑ in an empty box brings back what you
 * sent; Ctrl+S puts a draft aside and brings it back.
 */
export function ChatComposer({ chat, placeholder, workspaceId, projectId }: ChatComposerProps) {
  const { send, stop, queue, unqueue, update: updateChat, catalogs, loadCatalog, clis: chatClis, loadClis } = useChat()
  const clis = useClis((s) => s.clis)
  // A prompt link's draft (ADR 0061) starts the box; it is never sent on its own.
  const [text, setText] = useState(() => takeChatDraft(chat.id) ?? '')
  const [caret, setCaret] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [found, setFound] = useState<{ query: string; entries: FileEntry[] }>()
  const [picked, setPicked] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const recall = useRef<{ index: number; text: string } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const attachments = useAttachments(chat.id)
  const catalog = chat.cliId ? catalogs[chat.cliId] : undefined
  const loaded = catalog && catalog !== 'loading' ? catalog : undefined
  const model = loaded?.models.find((m) => m.id === (chat.model ?? ''))
  const efforts = model?.efforts ?? []
  const usage = useMemo(() => latestUsage(chat.messages), [chat.messages])
  const update = (patch: Parameters<typeof updateChat>[1]): Promise<void> => updateChat(chat.id, patch)
  const cliName = clis.find((c) => c.id === chat.cliId)?.displayName
  const canSend = Boolean(chat.cliId) && !chat.running && attachments.ready && (text.trim().length > 0 || attachments.attachments.length > 0)
  // While it answers, text (not files) waits as the next turn (ADR 0031).
  const canQueue = Boolean(chat.cliId) && chat.running && text.trim().length > 0 && attachments.items.length === 0

  const trigger: Trigger | null = dismissed === caret ? null : findTrigger(text, caret)
  const suggestions: Suggestion[] = useMemo(() => {
    if (!trigger) return []
    if (trigger.kind === '/') {
      const q = trigger.query.toLowerCase()
      const commands: ChatCommand[] = loaded?.commands ?? []
      return commands
        .filter((c) => c.name.toLowerCase().includes(q))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
        .slice(0, MAX_SUGGESTIONS)
        .map((c) => ({ key: c.name, value: c.name, label: `/${c.name}`, detail: c.argumentHint ? `${c.argumentHint}${c.description ? ` · ${c.description}` : ''}` : c.description }))
    }
    const files = found && found.query === trigger.query ? found.entries : []
    return files.slice(0, MAX_SUGGESTIONS).map((f) => ({ key: f.path, value: f.path, label: f.name, detail: f.path }))
  }, [trigger?.kind, trigger?.query, loaded?.commands, found]) // eslint-disable-line react-hooks/exhaustive-deps
  const active = picked < suggestions.length ? picked : 0

  useEffect(() => {
    if (chat.cliId) void loadCatalog(chat.cliId)
  }, [chat.cliId, loadCatalog])

  useEffect(() => {
    if (!chatClis.length) void loadClis()
  }, [chatClis.length, loadClis])

  // `@` searches the worktree's files as you type.
  const mentionQuery = trigger?.kind === '@' ? trigger.query : null
  useEffect(() => {
    if (!mentionQuery || !workspaceId) return
    let live = true
    const timer = setTimeout(() => {
      void api('files.search', { scope: { workspaceId }, query: mentionQuery })
        .then((entries) => live && setFound({ query: mentionQuery, entries }))
        .catch(() => live && setFound({ query: mentionQuery, entries: [] }))
    }, 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [mentionQuery, workspaceId])

  // A quote chosen in the conversation goes into the box (ADR 0058).
  useEffect(() => {
    const onQuote = (event: Event): void => {
      const { chatId, text: quoted } = (event as CustomEvent<{ chatId: string; text: string }>).detail
      if (chatId !== chat.id) return
      const block = `${quoted.split(/\r?\n/).map((l) => `> ${l}`).join('\n')}\n\n`
      setText((t) => (t ? `${t.replace(/\s*$/, '')}\n\n${block}` : block))
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.selectionStart = el.selectionEnd = el.value.length
      })
    }
    window.addEventListener(QUOTE_EVENT, onQuote)
    return () => window.removeEventListener(QUOTE_EVENT, onQuote)
  }, [chat.id])

  // A draft offered while the box is already open: it fills an empty box, or goes below what is typed.
  useEffect(() => {
    const onDraft = (event: Event): void => {
      if ((event as CustomEvent<{ chatId: string }>).detail.chatId !== chat.id) return
      const offered = takeChatDraft(chat.id)
      if (!offered) return
      setText((t) => (t.trim() ? `${t.replace(/\s*$/, '')}\n\n${offered}` : offered))
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    window.addEventListener(DRAFT_EVENT, onDraft)
    return () => window.removeEventListener(DRAFT_EVENT, onDraft)
  }, [chat.id])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    // Empty: one row. Measuring a wrapped placeholder (e.g. in a pane still being laid out) would freeze a tall box.
    if (text) el.style.height = `${Math.min(el.scrollHeight, 240)}px`
    el.style.overflowY = text && el.scrollHeight > 240 ? 'auto' : 'hidden'
  }, [text])

  const setDraft = (value: string, at = value.length): void => {
    setText(value)
    setCaret(at)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) el.selectionStart = el.selectionEnd = at
    })
  }

  const submit = async (): Promise<void> => {
    recall.current = null
    if (canQueue) {
      const value = text.trim()
      setDraft('')
      if (!(await queue(chat.id, value))) setDraft(value)
      return
    }
    if (!canSend) return
    const value = text.trim()
    const sent = attachments.attachments
    setDraft('')
    attachments.clear()
    const ok = await send(chat.id, value, sent)
    if (!ok) setDraft(value)
  }

  const accept = (s: Suggestion): void => {
    if (!trigger) return
    const next = applySuggestion(text, caret, trigger, s.value)
    setDraft(next.text, next.caret)
  }

  /** ↑ in an empty box (or on a recalled prompt) walks back through what you sent; ↓ comes forward. */
  const sentPrompts = (): string[] =>
    chat.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n'))
      .filter(Boolean)
  const walk = (direction: -1 | 1): boolean => {
    const recalled = recall.current
    if (!(text === '' || (recalled && recalled.text === text))) return false
    const prompts = sentPrompts()
    const index = (recalled?.index ?? prompts.length) + direction
    if (index < 0) return true
    if (index >= prompts.length) {
      recall.current = null
      setDraft('')
      return Boolean(recalled)
    }
    recall.current = { index, text: prompts[index]! }
    setDraft(prompts[index]!)
    return true
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPicked((active + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        accept(suggestions[active] ?? suggestions[0]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(caret)
        return
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      // Ctrl+S: put the draft aside, or bring the last one back into an empty box.
      e.preventDefault()
      const stash = readStash(chat.id)
      if (text.trim()) {
        writeStash(chat.id, [...stash, text].slice(-10))
        setDraft('')
      } else if (stash.length) {
        setDraft(stash.at(-1)!)
        writeStash(chat.id, stash.slice(0, -1))
      }
      return
    }
    if (e.key === 'ArrowUp' && e.currentTarget.selectionStart === 0 && !e.shiftKey && walk(-1)) return e.preventDefault()
    if (e.key === 'ArrowDown' && recall.current && e.currentTarget.selectionStart === text.length && walk(1)) return e.preventDefault()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape' && chat.running) {
      // Esc stops the reply, as in the CLIs (ADR 0047).
      e.preventDefault()
      void stop(chat.id)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = [...event.clipboardData.files]
    if (pasted.length > 0) {
      event.preventDefault()
      attachments.addFiles(pasted)
      return
    }
    const value = event.clipboardData.getData('text/plain')
    if (value.length > LONG_TEXT_CHARS) {
      // Long text travels as a file: it stays readable here and never hits command-line limits.
      event.preventDefault()
      attachments.addText(value)
    }
  }

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length) attachments.addFiles([...event.dataTransfer.files])
  }

  return (
    <div className={cx(styles.composerWrap, styles.composerWrapAgent)} onClick={focusChatInput}>
      <ComposerTracks chat={chat} workspaceId={workspaceId} projectId={projectId} />
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
        {suggestions.length > 0 && (
          <ul className={composer.suggestions} role="listbox" aria-label={trigger?.kind === '/' ? 'Commands and skills' : 'Files'}>
            {suggestions.map((s, i) => (
              <li key={s.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={cx(composer.suggestion, i === active && composer.suggestionActive)}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setPicked(i)}
                  onClick={() => accept(s)}
                >
                  <span className={composer.suggestionLabel}>{s.label}</span>
                  {s.detail && <span className={composer.suggestionDetail}>{s.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {chat.queued?.length ? (
          <ol className={styles.queued} aria-label="Waiting to be sent">
            {chat.queued.map((q, i) => (
              <li key={`${i}-${q}`} className={styles.queuedItem}>
                <span className={styles.queuedLabel}>{i === 0 ? 'Next' : 'Then'}</span>
                <span className={styles.queuedText}>{q}</span>
                <IconButton label={`Remove "${q.slice(0, 40)}" from the queue`} icon={<X />} size="sm" onClick={() => void unqueue(chat.id, i)} />
              </li>
            ))}
          </ol>
        ) : null}
        <AttachmentChips items={attachments.items.map((item) => ({ ...item, pending: !item.attachment }))} onRemove={attachments.remove} />
        <textarea
          ref={inputRef}
          data-chat-input
          className={styles.input}
          rows={1}
          placeholder={chat.cliId ? (chat.running ? 'Type the next message: it goes in when this reply ends' : (placeholder ?? PLACEHOLDER)) : 'Choose a CLI below to start'}
          value={text}
          disabled={!chat.cliId}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
            setDismissed(null)
            setPicked(0)
            if (recall.current && recall.current.text !== e.target.value) recall.current = null
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          aria-label="Message"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
        />
        <div className={styles.controls}>
          <Menu
            label="Add to the message"
            items={[
              { type: 'item', id: 'files', label: 'Files…', icon: <Paperclip />, hint: 'Or paste, or drop them here', onSelect: () => fileRef.current?.click() },
              { type: 'item', id: 'window', label: 'Picture of a window…', icon: <AppWindow />, onSelect: () => setCapturing(true) }
            ]}
            trigger={(props) => (
              <button type="button" {...props} className={composer.iconPill} aria-label="Add files or a picture" title="Add files or a picture" disabled={!chat.cliId}>
                <Plus aria-hidden />
              </button>
            )}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              attachments.addFiles([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          {chat.cliId && (
            <ModelPicker
              cliId={chat.cliId}
              model={chat.model ?? ''}
              switchable={Boolean(chat.agentId)}
              started={chat.messages.length > 0}
              onChange={(cliId, next) => {
                const keepEffort = next.efforts?.includes(chat.effort ?? '') ? chat.effort : ''
                rememberChatCli(cliId)
                void update({ ...(cliId !== chat.cliId ? { cliId } : {}), model: next.id, effort: keepEffort, ...(chat.fast && !next.fast ? { fast: false } : {}) })
              }}
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
          <Menu
            label="Permissions"
            items={[
              { type: 'item', id: 'read-only', label: 'Read-only', hint: 'Reads and answers', icon: <Eye />, checked: !chat.autoApprove, onSelect: () => void update({ autoApprove: false }) },
              { type: 'item', id: 'full', label: 'Full access', hint: 'Edits files, runs commands', icon: <LockOpen />, checked: chat.autoApprove, onSelect: () => void update({ autoApprove: true }) }
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
                <ChevronDown aria-hidden className={styles.chevron} />
              </button>
            )}
          />
          {model?.fast && (
            <button
              type="button"
              className={cx(composer.iconPill, chat.fast && composer.iconPillOn)}
              aria-pressed={Boolean(chat.fast)}
              aria-label="Fast mode"
              title={chat.fast ? 'Fast mode is on: quicker replies, at a higher cost' : 'Fast mode: quicker replies, at a higher cost'}
              onClick={() => void update({ fast: !chat.fast })}
            >
              <Zap aria-hidden />
            </button>
          )}
          {loaded?.plan && (
            <button
              type="button"
              className={cx(composer.iconPill, chat.plan && composer.iconPillOn)}
              aria-pressed={Boolean(chat.plan)}
              aria-label="Plan mode"
              title={chat.plan ? 'Plan mode is on: the agent plans and answers without changing anything' : 'Plan mode: the agent plans and answers without changing anything'}
              onClick={() => void update({ plan: !chat.plan })}
            >
              <ListTodo aria-hidden />
            </button>
          )}
          <span className={styles.flex} />
          {usage && <ContextMeter usage={usage} />}
          {chat.cliId && loaded?.limits && <UsageLimitsButton cliId={chat.cliId} cliName={cliName} />}
          {chat.running && <IconButton label="Queue as the next message" icon={<ListPlus />} size="md" disabled={!canQueue} onClick={() => void submit()} />}
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
      <WindowPicker
        open={capturing}
        onClose={() => setCapturing(false)}
        onPick={(sourceId) =>
          // Captured on this screen, then sent to the chat, which may live on a Hiveory server.
          attachments.addUpload('window.png', 'image', async () => {
            const picture = await api('chat.captureWindow', { sourceId })
            return api('chat.attach', { chatId: chat.id, name: picture.name, mime: 'image/png', data: picture.data })
          })
        }
      />
    </div>
  )
}
