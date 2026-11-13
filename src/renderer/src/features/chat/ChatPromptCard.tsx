import { useState } from 'react'
import { Check } from 'lucide-react'
import type { ChatPrompt, ChatPromptAnswer, ChatQuestion } from '@shared/domain/chat'
import { Button } from '../../components/ui/Button'
import { Markdown } from '../../components/ui/Markdown'
import { cx } from '../../lib/cx'
import { useChat } from '../../stores/chat'
import styles from './ChatPromptCard.module.css'

/**
 * What the running reply waits on the user for (ADR 0073): a tool to allow, the agent's questions, or
 * its plan. One card at a time, oldest first; the reply carries on once it is answered.
 */
export function ChatPromptCard({ chatId, prompts }: { chatId: string; prompts: ChatPrompt[] }) {
  const prompt = prompts[0]!
  const answer = useChat((s) => s.answer)
  const [busy, setBusy] = useState(false)
  const send = async (reply: ChatPromptAnswer): Promise<void> => {
    setBusy(true)
    await answer(chatId, prompt.id, reply)
    setBusy(false)
  }
  const count = prompts.length > 1 ? `1 of ${prompts.length}` : undefined

  return (
    <section className={styles.card} aria-label="The agent is waiting for you" onClick={(e) => e.stopPropagation()}>
      {prompt.kind === 'permission' && <PermissionBody key={prompt.id} prompt={prompt} busy={busy} count={count} send={send} />}
      {prompt.kind === 'question' && <QuestionBody key={prompt.id} prompt={prompt} busy={busy} count={count} send={send} />}
      {prompt.kind === 'plan' && <PlanBody key={prompt.id} prompt={prompt} busy={busy} count={count} send={send} />}
    </section>
  )
}

interface BodyProps<K extends ChatPrompt['kind']> {
  prompt: Extract<ChatPrompt, { kind: K }>
  busy: boolean
  /** "1 of 3" when more wait after this one. */
  count?: string
  send: (answer: ChatPromptAnswer) => Promise<void>
}

function Header({ children, count }: { children: React.ReactNode; count?: string }) {
  return (
    <header className={styles.header}>
      <span className={styles.title}>{children}</span>
      {count && <span className={styles.count}>{count}</span>}
    </header>
  )
}

function PermissionBody({ prompt, busy, count, send }: BodyProps<'permission'>) {
  return (
    <>
      <Header count={count}>
        <span className={styles.tool}>{prompt.tool}</span> needs your permission
      </Header>
      {prompt.detail && <code className={styles.detail}>{prompt.detail}</code>}
      <details className={styles.input}>
        <summary>Full input</summary>
        <pre>{prompt.input}</pre>
      </details>
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send({ kind: 'permission', allow: false })}>
          Deny
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void send({ kind: 'permission', allow: true })}>
          Allow
        </Button>
      </div>
    </>
  )
}

/** A question's answer: its chosen labels, or the user's own words. */
const answerOf = (picked: string[], own: string): string => own.trim() || picked.join(', ')

function QuestionBody({ prompt, busy, count, send }: BodyProps<'question'>) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [own, setOwn] = useState<Record<string, string>>({})
  const ready = prompt.questions.length > 0 && prompt.questions.every((q) => answerOf(picked[q.question] ?? [], own[q.question] ?? ''))
  const toggle = (q: ChatQuestion, label: string): void =>
    setPicked((current) => {
      const now = current[q.question] ?? []
      const next = q.multiSelect ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : [label]
      return { ...current, [q.question]: next }
    })
  const submit = (): void =>
    void send({ kind: 'question', answers: Object.fromEntries(prompt.questions.map((q) => [q.question, answerOf(picked[q.question] ?? [], own[q.question] ?? '')])) })

  return (
    <>
      {prompt.questions.map((q, i) => (
        <fieldset key={q.question} className={styles.question}>
          {i === 0 ? <Header count={count}>{q.question}</Header> : <legend className={styles.title}>{q.question}</legend>}
          <div className={styles.options} role="group" aria-label={q.header ?? q.question}>
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o.label)
              return (
                <button key={o.label} type="button" className={cx(styles.option, on && styles.optionOn)} aria-pressed={on} onClick={() => toggle(q, o.label)}>
                  <span className={styles.optionText}>
                    <span className={styles.optionLabel}>{o.label}</span>
                    {o.description && <span className={styles.optionDescription}>{o.description}</span>}
                  </span>
                  {on && <Check aria-hidden className={styles.check} />}
                </button>
              )
            })}
            <input
              className={styles.own}
              aria-label={`Your own answer to: ${q.question}`}
              placeholder={q.options.length ? 'Something else' : 'Your answer'}
              value={own[q.question] ?? ''}
              spellCheck={false}
              onChange={(e) => setOwn((current) => ({ ...current, [q.question]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && ready && submit()}
            />
          </div>
        </fieldset>
      ))}
      <div className={styles.actions}>
        <Button size="sm" variant="primary" loading={busy} disabled={!ready} onClick={submit}>
          Answer
        </Button>
      </div>
    </>
  )
}

function PlanBody({ prompt, busy, count, send }: BodyProps<'plan'>) {
  const [feedback, setFeedback] = useState('')
  return (
    <>
      <Header count={count}>Plan</Header>
      <div className={styles.plan}>{prompt.plan ? <Markdown text={prompt.plan} /> : <p>No plan text.</p>}</div>
      <input
        className={styles.own}
        aria-label="What to change in the plan"
        placeholder="What should change?"
        value={feedback}
        spellCheck={false}
        onChange={(e) => setFeedback(e.target.value)}
      />
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send({ kind: 'plan', approve: false, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) })}>
          Keep planning
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void send({ kind: 'plan', approve: true })}>
          Approve
        </Button>
      </div>
    </>
  )
}
