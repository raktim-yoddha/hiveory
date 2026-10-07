import { useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { create } from 'zustand'
import { GENERAL_TEAM, MAX_BOT_BRIEF, MAX_BOT_MEMORY, MAX_BOT_NAME, type BotView } from '@shared/domain/bot'
import { Button, IconButton } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { TextAreaField, TextField, TextInput } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { useBots } from '../../stores/bots'
import { useChat } from '../../stores/chat'
import { useClis } from '../../stores/data'
import type { BotTemplate } from './bot-templates'
import styles from './Bots.module.css'

/** Which bot the editor is open for: 'new' (maybe from a template), a bot id, or closed. */
export const useBotEditor = create<{ target: string | null; template?: BotTemplate; open(target: string, template?: BotTemplate): void; close(): void }>((set) => ({
  target: null,
  open: (target, template) => set({ target, template }),
  close: () => set({ target: null, template: undefined })
}))

interface Draft {
  name: string
  brief: string
  cliId: string
  autoApprove: boolean
  chief: boolean
  messaging: boolean
  routines: boolean
  teamId: string
  memory: string[]
}

const draftOf = (bot: BotView | undefined, firstBot: boolean, template?: BotTemplate): Draft => ({
  name: bot?.name ?? template?.name ?? '',
  brief: bot?.brief ?? template?.brief ?? '',
  cliId: bot?.cliId ?? '',
  autoApprove: bot?.autoApprove ?? false,
  chief: bot?.chief ?? firstBot,
  messaging: bot?.messaging ?? true,
  routines: bot?.routines ?? template?.routines ?? false,
  teamId: bot?.teamId ?? GENERAL_TEAM.id,
  memory: bot?.memory ?? []
})

/** Create or edit a bot: name, brief, engine, permissions, its role and its memory. */
export function BotEditor() {
  const target = useBotEditor((s) => s.target)
  const loadClis = useChat((s) => s.loadClis)
  useEffect(() => {
    if (target) void loadClis()
  }, [target, loadClis])
  // Keyed by target: every open starts from the bot as it is now.
  return target ? <EditorDialog key={target} target={target} /> : null
}

function EditorDialog({ target }: { target: string }) {
  const close = useBotEditor((s) => s.close)
  const template = useBotEditor((s) => s.template)
  const { bots, teams, create: createBot, update, remove } = useBots()
  const chatClis = useChat((s) => s.clis)
  const clis = useClis((s) => s.clis)
  const bot = target !== 'new' ? bots.find((b) => b.id === target) : undefined
  const [draft, setDraft] = useState<Draft>(() => draftOf(bot, !bots.some((b) => b.chief && b.teamId === GENERAL_TEAM.id), template))
  const [fact, setFact] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // A new bot starts on the first installed engine, so it works straight away.
  const cliId = draft.cliId || (bot ? '' : (chatClis[0] ?? ''))

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((d) => ({ ...d, [key]: value }))
  const name = (id: string) => clis.find((c) => c.id === id)?.displayName ?? id
  const addFact = (): void => {
    const text = fact.replace(/\s+/g, ' ').trim()
    if (!text || draft.memory.length >= MAX_BOT_MEMORY) return
    set('memory', [...draft.memory.filter((m) => m.toLowerCase() !== text.toLowerCase()), text])
    setFact('')
  }

  const save = async (): Promise<void> => {
    if (!draft.name.trim()) return
    setBusy(true)
    const fields = { name: draft.name.trim(), brief: draft.brief, cliId, autoApprove: draft.autoApprove, chief: draft.chief, messaging: draft.messaging, routines: draft.routines, teamId: draft.teamId }
    if (bot) await update(bot.id, { ...fields, memory: draft.memory })
    else await createBot({ ...fields, ...(template ? { worksOn: template.worksOn } : {}) })
    setBusy(false)
    close()
  }

  return (
    <>
      <Modal
        open={!confirmDelete}
        title={bot ? `Edit ${bot.name}` : 'New bot'}
        width="lg"
        onClose={close}
        footer={
          <>
            {bot && (
              <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>
                Delete bot
              </Button>
            )}
            <span className={styles.footerSpacer} />
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={busy} disabled={!draft.name.trim()}>
              {bot ? 'Save' : 'Create bot'}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <TextField label="Name" value={draft.name} maxLength={MAX_BOT_NAME} placeholder="Release notes editor" onChange={(v) => set('name', v)} autoFocus />
          <TextAreaField
            label="Brief"
            value={draft.brief}
            maxLength={MAX_BOT_BRIEF}
            rows={6}
            placeholder="What it owns, the standards it keeps, and when it should stop and ask you."
            onChange={(v) => set('brief', v)}
          />
          <Select
            label="Engine"
            value={cliId}
            options={[{ value: '', label: 'Choose an engine' }, ...chatClis.map((id) => ({ value: id, label: name(id) }))]}
            onChange={(v) => set('cliId', v)}
          />
          <div className={styles.switchRow}>
            <span className={styles.switchText}>
              <span className={styles.switchTitle}>Full access</span>
              <span className={styles.switchHint}>New threads may edit files and run commands. Off: it reads and answers.</span>
            </span>
            <Toggle label="Full access" checked={draft.autoApprove} onChange={(v) => set('autoApprove', v)} />
          </div>
          {teams.length > 1 && (
            <Select
              label="Team"
              value={draft.teamId}
              options={teams.map((t) => ({ value: t.id, label: t.name }))}
              onChange={(teamId) =>
                // A new bot leads a team that has no Chief yet, as the first bot in a team does.
                setDraft((d) => ({ ...d, teamId, ...(bot ? {} : { chief: !bots.some((b) => b.chief && b.teamId === teamId) }) }))
              }
            />
          )}
          <div className={styles.switchRow}>
            <span className={styles.switchText}>
              <span className={styles.switchTitle}>Chief of Staff</span>
              <span className={styles.switchHint}>Leads its team: your main contact for it, hands work to its bots and brings the results back. One per team.</span>
            </span>
            <Toggle label="Chief of Staff" checked={draft.chief} onChange={(v) => set('chief', v)} />
          </div>
          <div className={styles.switchRow}>
            <span className={styles.switchText}>
              <span className={styles.switchTitle}>Team messaging</span>
              <span className={styles.switchHint}>May consult other bots, and be consulted. The Chief of Staff can always reach it.</span>
            </span>
            <Toggle label="Team messaging" checked={draft.messaging} onChange={(v) => set('messaging', v)} />
          </div>
          <div className={styles.switchRow}>
            <span className={styles.switchText}>
              <span className={styles.switchTitle}>Runs on a schedule</span>
              <span className={styles.switchHint}>May have routines: work it starts on its own at the times you set. Off: it only works when asked.</span>
            </span>
            <Toggle label="Runs on a schedule" checked={draft.routines} onChange={(v) => set('routines', v)} />
          </div>
          {bot && (
            <>
              <span className={styles.sectionLabel}>Memory</span>
              <ul className={styles.memory} aria-label="Memory">
                {draft.memory.map((m) => (
                  <li key={m} className={styles.memoryItem}>
                    <span>{m}</span>
                    <IconButton label={`Forget “${m}”`} icon={<X />} onClick={() => set('memory', draft.memory.filter((x) => x !== m))} />
                  </li>
                ))}
                {draft.memory.length === 0 && <li className={styles.memoryEmpty}>Nothing yet. The bot saves lasting facts as it works.</li>}
              </ul>
              <div className={styles.nameRow}>
                <TextInput
                  aria-label="New memory note"
                  value={fact}
                  placeholder="Add a fact it should always know"
                  onChange={setFact}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addFact()
                    }
                  }}
                />
                <IconButton label="Add memory note" icon={<Plus />} onClick={addFact} disabled={!fact.trim()} />
              </div>
            </>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title={bot ? `Delete ${bot.name}?` : 'Delete bot?'}
        confirmLabel="Delete bot"
        danger
        busy={busy}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (!bot) return
          setBusy(true)
          void remove(bot.id).finally(() => {
            setBusy(false)
            setConfirmDelete(false)
            close()
          })
        }}
      >
        Its threads are deleted. Files it made in its folder stay on disk.
      </ConfirmDialog>
    </>
  )
}
