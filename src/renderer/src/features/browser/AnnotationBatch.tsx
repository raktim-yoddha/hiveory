import { useState } from 'react'
import { ChevronDown, Copy, MessageSquareText, Pencil, Send, Trash2, X } from 'lucide-react'
import { annotationsText, type AnnotationIntent, type BrowserAnnotation, type CliInstanceView } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { Button, IconButton } from '../../components/ui/Button'
import { Menu, type MenuEntry } from '../../components/ui/Menu'
import { STATUS_LABEL } from '../../components/ui/StatusDot'
import { Tabs } from '../../components/ui/Tabs'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useAgents, useClis } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { agentActions, waitUntilReady } from '../agents/agent-actions'
import styles from './BrowserPane.module.css'

const NO_AGENTS: CliInstanceView[] = []

/**
 * A page's notes as one batch (ADR 0042, like Orca): numbered as marked on the page, each a change or a
 * question. Send them to an agent of this worktree or to a new one, or copy them; sent notes clear.
 */
export function AnnotationBatch({ scope, notes, onSent }: { scope: string; notes: BrowserAnnotation[]; onSent: (message: string) => void }) {
  const [open, setOpen] = useState(true)
  const agents = useAgents((s) => s.byWorkspace[scope] ?? NO_AGENTS)
  const runtime = useAgents((s) => s.runtime)
  const clis = useClis((s) => s.clis)
  const isAgent = (cliId: string): boolean => clis.find((c) => c.id === cliId)?.kind !== 'shell'
  const text = annotationsText(notes)
  const count = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`

  const clear = (): void => notes.forEach((n) => void api('browser.deleteAnnotation', { id: n.id }).catch(() => undefined))

  const sendTo = async (agent: Pick<CliInstanceView, 'id' | 'petName'>): Promise<void> => {
    const sent = await runAction(`Send notes to ${agent.petName}`, () => api('agents.sendMessage', { instanceId: agent.id, message: text }))
    if (sent === undefined) return
    clear()
    onSent(`Sent ${count} to ${agent.petName}`)
  }

  const sendToNew = async (cliId: string): Promise<void> => {
    const created = await agentActions.open(scope, cliId)
    if (!created) return
    onSent(`Starting ${created.petName}; the notes go in once it is ready`)
    const ready = await waitUntilReady(created.id)
    if (ready !== 'ready') {
      onSent(ready === 'waiting' ? `${created.petName} is asking something first; send the notes after answering it` : `${created.petName} did not get ready; the notes were kept`)
      return
    }
    await sendTo(created)
  }

  const items: MenuEntry[] = [
    { type: 'label', label: 'Send notes to' },
    ...agents
      .filter((a) => isAgent(a.cliId))
      .map((a): MenuEntry => {
        const r = runtime[a.id] ?? a.runtime
        return { type: 'item', id: `to-${a.id}`, label: a.petName, icon: <CliLogo cliId={a.cliId} size="sm" />, hint: r.running ? STATUS_LABEL[r.status] : 'Not running', disabled: !r.running, onSelect: () => void sendTo(a) }
      }),
    { type: 'separator' },
    { type: 'label', label: 'New agent' },
    ...clis
      .filter((c) => c.available && c.kind !== 'shell')
      .map((c): MenuEntry => ({ type: 'item', id: `new-${c.id}`, label: c.displayName, icon: <CliLogo cliId={c.id} size="sm" />, onSelect: () => void sendToNew(c.id) }))
  ]

  return (
    <section className={styles.batch} aria-label={`Browser notes: ${count}`}>
      <header className={styles.batchHead}>
        <button type="button" className={styles.batchToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
          <MessageSquareText aria-hidden />
          <span>{count}</span>
          <ChevronDown aria-hidden className={cx(!open && styles.turned)} />
        </button>
        <Menu label="Send notes" align="end" items={items} trigger={(props) => <Button {...props} size="sm" variant="primary" icon={<Send />}>Send</Button>} />
        <Button
          size="sm"
          icon={<Copy />}
          onClick={() => void runAction('Copy notes', () => api('clipboard.writeText', { text })).then(() => onSent(`Copied ${count}`))}
        >
          Copy
        </Button>
        <IconButton label="Clear all notes" icon={<Trash2 />} onClick={clear} />
      </header>
      {open && (
        <ol className={styles.batchList}>
          {notes.map((n, i) => (
            <NoteRow key={n.id} note={n} number={i + 1} />
          ))}
        </ol>
      )}
    </section>
  )
}

const INTENTS: Array<{ value: AnnotationIntent; label: string }> = [
  { value: 'change', label: 'Change' },
  { value: 'question', label: 'Question' }
]

/** One note: its element, text and intent; Edit changes the text or intent in place (Ctrl+Enter saves). */
function NoteRow({ note, number }: { note: BrowserAnnotation; number: number }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.note)
  const [intent, setIntent] = useState<AnnotationIntent>(note.intent ?? 'change')
  const save = (): void => {
    if (!text.trim()) return
    void runAction('Save note', () => api('browser.updateAnnotation', { id: note.id, note: text, intent })).then(() => setEditing(false))
  }
  return (
    <li className={styles.batchItem}>
      <span className={styles.batchNumber}>{number}</span>
      <span className={styles.batchText}>
        <span className={styles.batchTarget} title={note.element.selector}>
          {note.element.role}
          {note.element.name ? ` "${note.element.name}"` : ''}
        </span>
        {editing ? (
          <>
            <textarea
              className={styles.batchEditor}
              aria-label={`Note ${number}`}
              value={text}
              rows={2}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
            <span className={styles.batchEditRow}>
              <Tabs<AnnotationIntent> label="Intent" variant="segmented" value={intent} onChange={setIntent} options={INTENTS} />
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={!text.trim()} onClick={save}>
                Save
              </Button>
            </span>
          </>
        ) : (
          <>
            <span>{note.note}</span>
            <span className={styles.batchIntent}>{note.intent === 'question' ? 'Question' : 'Change'}</span>
          </>
        )}
      </span>
      {!editing && (
        <IconButton
          label={`Edit note ${number}`}
          icon={<Pencil />}
          onClick={() => {
            setText(note.note)
            setIntent(note.intent ?? 'change')
            setEditing(true)
          }}
        />
      )}
      <IconButton label={`Remove note ${number}`} icon={<X />} onClick={() => void api('browser.deleteAnnotation', { id: note.id }).catch(() => undefined)} />
    </li>
  )
}
