import { memo, useEffect, useRef, useState } from 'react'
import { AlertCircle, Brain, CheckCircle2, ChevronRight, Loader2, Quote, Wrench, XCircle } from 'lucide-react'
import type { ChatMessage, ChatPart, ChatSession } from '@shared/domain/chat'
import { AppLogo } from '../../components/brand/AppLogo'
import { CliLogo } from '../../components/cli/CliLogo'
import { useClis } from '../../stores/data'
import { AttachmentChips } from './AttachmentChips'
import { Markdown } from '../../components/ui/Markdown'
import { focusChatInput } from './focus-input'
import { TurnChanges } from './ComposerExtras'
import { QUOTE_EVENT } from './ChatComposer'
import styles from './Chat.module.css'
import composer from './Composer.module.css'

/**
 * The conversation; follows new output unless the user has scrolled up. Text selected in a reply can
 * be quoted into the message box, and each turn that changed files says so (ADR 0058).
 */
export function ChatMessages({ chat, welcome, workspaceId }: { chat: ChatSession & { running: boolean }; welcome?: { title: string; text: string }; workspaceId?: string }) {
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [quote, setQuote] = useState<{ text: string; top: number; left: number } | null>(null)

  /** A selection inside one reply offers "Quote" just above it. */
  const offerQuote = (): void => {
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    const node = selection?.anchorNode
    const reply = (node instanceof Element ? node : node?.parentElement)?.closest('[data-reply]')
    if (!text || !selection?.rangeCount || !reply || !listRef.current?.contains(reply)) return setQuote(null)
    const box = selection.getRangeAt(0).getBoundingClientRect()
    setQuote({ text, top: box.top, left: box.left + box.width / 2 })
  }
  const cliName = useClis((s) => s.clis.find((c) => c.id === chat.cliId)?.displayName)

  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat.messages])

  return (
    <div
      ref={listRef}
      className={styles.messages}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        if (quote) setQuote(null)
      }}
      aria-live="polite"
      onClick={focusChatInput}
      onMouseUp={offerQuote}
    >
      {quote && (
        <button
          type="button"
          className={composer.quote}
          style={{ top: quote.top, left: quote.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            window.dispatchEvent(new CustomEvent(QUOTE_EVENT, { detail: { chatId: chat.id, text: quote.text } }))
            window.getSelection()?.removeAllRanges()
            setQuote(null)
          }}
        >
          <Quote aria-hidden /> Quote
        </button>
      )}
      <div className={styles.thread}>
        {chat.messages.length === 0 && (
          <div className={styles.welcome}>
            {/* The chat's CLI, or Hiveory's own mark until one is chosen — never a generic icon (ADR 0039). */}
            <span className={styles.welcomeLogo}>{chat.cliId ? <CliLogo cliId={chat.cliId} size="xl" /> : <AppLogo size="lg" />}</span>
            <p className={styles.welcomeTitle}>{welcome?.title ?? (cliName ? `Chat with ${cliName}` : 'Start a chat')}</p>
            <p className={styles.welcomeText}>
              {welcome?.text ??
                (cliName
                  ? 'Ask anything. Paste or drop images, files and long text. Enter sends, Shift+Enter adds a line.'
                  : 'Choose a CLI below, then ask anything.')}
            </p>
          </div>
        )}
        {chat.messages.map((m) => (
          <Message key={m.id} message={m} chatId={chat.id} workspaceId={workspaceId} />
        ))}
      </div>
    </div>
  )
}

/** Memoized: while one message streams, the others (and their Markdown) are not re-rendered. */
const Message = memo(function Message({ message, chatId, workspaceId }: { message: ChatMessage; chatId: string; workspaceId?: string }) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n')
    return (
      <div className={styles.userTurn}>
        {message.attachments && <AttachmentChips items={message.attachments.map((a, i) => ({ ...a, key: `${i}:${a.path}` }))} />}
        {text && <div className={styles.user}>{text}</div>}
      </div>
    )
  }
  return (
    <div className={styles.assistant}>
      <div className={styles.assistantBody} data-reply>
        {message.parts.map((part, i) => (
          <Part key={i} part={part} streaming={Boolean(message.streaming)} />
        ))}
        {message.streaming && message.parts.length === 0 && (
          <span className={styles.thinking}>
            <Loader2 className="spin" aria-hidden /> Working…
          </span>
        )}
        {message.error && (
          <div className={styles.error} role="alert">
            <AlertCircle aria-hidden />
            <span>{message.error}</span>
          </div>
        )}
        {!message.streaming && <TurnChanges chatId={chatId} message={message} workspaceId={workspaceId} />}
      </div>
    </div>
  )
})

const Part = memo(function Part({ part, streaming }: { part: ChatPart; streaming: boolean }) {
  if (part.kind === 'text') return <Markdown text={part.text} streaming={streaming} />
  if (part.kind === 'thinking') {
    return (
      <details className={styles.thought}>
        <summary>
          <Brain aria-hidden /> Thinking <ChevronRight className={styles.chev} aria-hidden />
        </summary>
        <div className={styles.thoughtBody}>{part.text}</div>
      </details>
    )
  }
  const Icon = part.status === 'running' ? Loader2 : part.status === 'error' ? XCircle : CheckCircle2
  return (
    <details className={styles.tool} data-status={part.status}>
      <summary>
        <Wrench aria-hidden className={styles.toolIcon} />
        <span className={styles.toolName}>{part.name}</span>
        {part.detail && <span className={styles.toolDetail}>{part.detail}</span>}
        <Icon aria-label={part.status} className={part.status === 'running' ? 'spin' : styles.toolState} />
      </summary>
      {part.output && <pre className={styles.toolOutput}>{part.output}</pre>}
    </details>
  )
})
