import { memo, useEffect, useRef } from 'react'
import { AlertCircle, Brain, CheckCircle2, ChevronRight, Loader2, Wrench, XCircle } from 'lucide-react'
import type { ChatMessage, ChatPart, ChatSession } from '@shared/domain/chat'
import { CliLogo } from '../../components/cli/CliLogo'
import { useClis } from '../../stores/data'
import { AttachmentChips } from './AttachmentChips'
import { Markdown } from '../../components/ui/Markdown'
import styles from './Chat.module.css'

/** The conversation; follows new output unless the user has scrolled up. */
export function ChatMessages({ chat }: { chat: ChatSession & { running: boolean } }) {
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
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
      }}
      aria-live="polite"
    >
      <div className={styles.thread}>
        {chat.messages.length === 0 && (
          <div className={styles.welcome}>
            {chat.cliId && (
              <span className={styles.welcomeLogo}>
                <CliLogo cliId={chat.cliId} size="xl" />
              </span>
            )}
            <p className={styles.welcomeTitle}>{cliName ? `Chat with ${cliName}` : 'Start a chat'}</p>
            <p className={styles.welcomeText}>
              {cliName
                ? 'Ask anything. Paste or drop images, files and long text. Enter sends, Shift+Enter adds a line.'
                : 'Choose a CLI below, then ask anything.'}
            </p>
          </div>
        )}
        {chat.messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
      </div>
    </div>
  )
}

/** Memoized: while one message streams, the others (and their Markdown) are not re-rendered. */
const Message = memo(function Message({ message }: { message: ChatMessage }) {
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
      <div className={styles.assistantBody}>
        {message.parts.map((part, i) => (
          <Part key={i} part={part} />
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
      </div>
    </div>
  )
})

const Part = memo(function Part({ part }: { part: ChatPart }) {
  if (part.kind === 'text') return <Markdown text={part.text} />
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
