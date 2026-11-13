import { useState } from 'react'
import { Check, CircleHelp, ListChecks, ShieldQuestion } from 'lucide-react'
import type { ChatPrompt, ChatPromptAnswer, ChatQuestion } from '@shared/domain/chat'
import { Button } from '../../components/ui/Button'
import { TextInput } from '../../components/ui/TextField'
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
  const more = prompts.length > 1 ? <span className={styles.more}>{prompts.length - 1} more waiting</span> : null

  return (
    <section className={styles.card} aria-label="The agent is waiting for you" onClick={(e) => e.stopPropagation()}>
      {prompt.kind === 'permission' && <PermissionBody key={prompt.id} prompt={prompt} busy={busy} more={more} send={send} />}
      {prompt.kind === 'question' && <QuestionBody key={prompt.id} prompt={prompt} busy={busy} more={more} send={send} />}
      {prompt.kind === 'plan' && <PlanBody key={prompt.id} prompt={prompt} busy={busy} more={more} send={send} />}
    </section>
  )
}

interface BodyProps<K extends ChatPrompt['kind']> {
  prompt: Extract<ChatPrompt, { kind: K }>
  busy: boolean
  more: React.ReactNode
  send: (answer: ChatPromptAnswer) => Promise<void>
}

function PermissionBody({ prompt, busy, more, send }: BodyProps<'permission'>) {
  return (
    <>
      <header className={styles.header}>
        <ShieldQuestion aria-hidden className={styles.icon} />
        <span className={styles.title}>Allow {prompt.tool}?</span>
        {more}
      </header>
      {prompt.detail && <code className={styles.detail}>{prompt.detail}</code>}
      <details className={styles.input}>
        <summary>Everything it would send</summary>
        <pre>{prompt.input}</pre>
      </details>
      <div className={styles.actions}>
        <Button size="sm" disabled={busy} onClick={() => void send({ kind: 'permission', allow: false })}>
          Deny
        </Button>
        <Button size="sm" variant="primary" icon={<Check />} loading={busy} onClick={() => void send({ kind: 'permission', allow: true })}>
          Allow
        </Button>
      </div>
    </>
  )
}

/** A question's answer: its chosen labels, or the user's own words. */
const answerOf = (q: ChatQuestion, picked: string[], own: string): string => own.trim() || picked.join(', ')

function QuestionBody({ prompt, busy, more, send }: BodyProps<'question'>) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [own, setOwn] = useState<Record<string, string>>({})
  const ready = prompt.questions.length > 0 && prompt.questions.every((q) => answerOf(q, picked[q.question] ?? [], own[q.question] ?? ''))
  const toggle = (q: ChatQuestion, label: string): void =>
    setPicked((current) => {
      const now = current[q.question] ?? []
      const next = q.multiSelect ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : [label]
      return { ...current, [q.question]: next }
    })
  const submit = (): void =>
    void send({ kind: 'question', answers: Object.fromEntries(prompt.questions.map((q) => [q.question, answerOf(q, picked[q.question] ?? [], own[q.question] ?? '')])) })

  return (
    <>
      <header className={styles.header}>
        <CircleHelp aria-hidden className={styles.icon} />
        <span className={styles.title}>{prompt.questions.length > 1 ? 'The agent has questions' : 'The agent has a question'}</span>
        {more}
      </header>
      {prompt.questions.map((q) => (
        <fieldset key={q.question} className={styles.question}>
          <legend className={styles.questionText}>
            {q.header && <span className={styles.questionHeader}>{q.header}</span>}
            {q.question}
          </legend>
          <div className={styles.options}>
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o.label)
              return (
                <button key={o.label} type="button" className={cx(styles.option, on && styles.optionOn)} aria-pressed={on} onClick={() => toggle(q, o.label)}>
                  {on && <Check aria-hidden className={styles.check} />}
                  <span className={styles.optionLabel}>{o.label}</span>
                  {o.description && <span className={styles.optionDescription}>{o.description}</span>}
                </button>
              )
            })}
          </div>
          <TextInput
            className={styles.own}
            aria-label={`Your own answer to: ${q.question}`}
            placeholder={q.options.length ? 'Or answer in your own words' : 'Your answer'}
            value={own[q.question] ?? ''}
            onChange={(value) => setOwn((current) => ({ ...current, [q.question]: value }))}
            onKeyDown={(e) => e.key === 'Enter' && ready && submit()}
          />
        </fieldset>
      ))}
      <div className={styles.actions}>
        <Button size="sm" variant="primary" icon={<Check />} loading={busy} disabled={!ready} onClick={submit}>
          Answer
        </Button>
      </div>
    </>
  )
}

function PlanBody({ prompt, busy, more, send }: BodyProps<'plan'>) {
  const [feedback, setFeedback] = useState('')
  return (
    <>
      <header className={styles.header}>
        <ListChecks aria-hidden className={styles.icon} />
        <span className={styles.title}>Carry out this plan?</span>
        {more}
      </header>
      <div className={styles.plan}>{prompt.plan ? <Markdown text={prompt.plan} /> : <p>The agent finished planning.</p>}</div>
      <TextInput className={styles.own} aria-label="What to change in the plan" placeholder="What should change? (to keep planning)" value={feedback} onChange={setFeedback} />
      <div className={styles.actions}>
        <Button size="sm" disabled={busy} onClick={() => void send({ kind: 'plan', approve: false, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) })}>
          Keep planning
        </Button>
        <Button size="sm" variant="primary" icon={<Check />} loading={busy} onClick={() => void send({ kind: 'plan', approve: true })}>
          Approve plan
        </Button>
      </div>
    </>
  )
}
