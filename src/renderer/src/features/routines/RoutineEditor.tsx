import { useEffect, useRef, useState } from 'react'
import { mainWorkspaceId } from '@shared/domain'
import { Paperclip, Play, Trash2 } from 'lucide-react'
import { create } from 'zustand'
import type { ChatAttachment } from '@shared/domain/chat'
import { INTERVAL_MINUTES, MAX_ROUTINE_FILE_BYTES, MAX_ROUTINE_FILES, MAX_ROUTINE_NAME, MAX_ROUTINE_PROMPT, type RepeatPreset, type RoutineSchedule, type RoutineTarget, type RoutineView } from '@shared/domain/routine'
import { compileRepeat, cronProblem, nextRuns } from '@shared/domain/routine-schedule'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { TextAreaField, TextField } from '../../components/ui/TextField'
import { cx } from '../../lib/cx'
import { useClis, useProjects, useWorkspaces } from '../../stores/data'
import { api } from '../../lib/api'
import { reportError, runAction } from '../../stores/notices'
import { useRoutines } from '../../stores/routines'
import { AttachmentChips } from '../chat/AttachmentChips'
import { base64Of } from '../chat/useAttachments'
import { cronDays, localZone, sameZone, when, WEEKDAYS } from './routine-text'
import form from '../../components/ui/form.module.css'
import styles from './Routines.module.css'

type Target = { routineId: string } | { startsAt?: string; target?: RoutineTarget }

/** What the editor is open for: a routine, a new one (for a Worktree, or one to pick; maybe at a time), or nothing. */
export const useRoutineEditor = create<{ target: Target | null; open(target: Target): void; close(): void }>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null })
}))

type Repeat = 'once' | 'interval' | RepeatPreset

interface Draft {
  name: string
  /** Who does it: a new agent of this CLI in this Worktree (ADR 0040). */
  cliId: string
  projectId: string
  workspaceId: string
  prompt: string
  date: string
  time: string
  repeat: Repeat
  everyMinutes: string
  days: number[]
  cron: string
  timeoutMinutes: string
  endsDate: string
  /** Copies kept for every run (ADR 0030). */
  attachments: ChatAttachment[]
}

const pad = (n: number): string => String(n).padStart(2, '0')
const dateOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeOf = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`
/** "HH:MM" from a preset's rule (minute hour …), or the fallback when it has none. */
const ruleTime = (expr: string, fallback: string): string => {
  const [minute, hour] = expr.trim().split(/\s+/).map(Number)
  return Number.isInteger(minute) && Number.isInteger(hour) ? `${pad(hour!)}:${pad(minute!)}` : fallback
}
/** The next whole hour: where a new routine starts unless a time was picked. */
const nextHour = (): Date => new Date(Math.ceil((Date.now() + 1) / 3_600_000) * 3_600_000)

const draftOf = (routine: RoutineView | undefined, target: Target): Draft => {
  const start = new Date(routine?.startsAt ?? ('startsAt' in target && target.startsAt ? target.startsAt : nextHour().toISOString()))
  const s = routine?.schedule
  const doing = routine ? routine.target : 'target' in target ? target.target : undefined
  return {
    name: routine?.name ?? '',
    cliId: doing?.cliId ?? '',
    projectId: doing?.projectId ?? '',
    workspaceId: doing?.workspaceId ?? '',
    prompt: routine?.prompt ?? '',
    date: dateOf(start),
    // A calendar rule's own hour and minute are what runs; the start date only says from when.
    time: s?.kind === 'cron' && s.preset !== 'custom' ? ruleTime(s.expr, timeOf(start)) : timeOf(start),
    repeat: !s ? 'once' : s.kind === 'cron' ? s.preset : s.kind,
    everyMinutes: s?.kind === 'interval' ? String(s.everyMinutes) : '30',
    days: s?.kind === 'cron' && s.preset === 'selected-days' ? cronDays(s.expr) : [start.getDay()],
    cron: s?.kind === 'cron' ? s.expr : '0 9 * * 1-5',
    timeoutMinutes: routine?.timeoutMinutes ? String(routine.timeoutMinutes) : '',
    endsDate: routine?.endsAt ? dateOf(new Date(routine.endsAt)) : '',
    attachments: routine?.attachments ?? []
  }
}

/** The draft's schedule, or why it isn't one yet. */
function scheduleOf(d: Draft, start: Date, timezone: string): RoutineSchedule | string {
  if (Number.isNaN(start.getTime())) return 'Pick a date and time.'
  if (d.repeat === 'once') return { kind: 'once' }
  if (d.repeat === 'interval') {
    const n = Number(d.everyMinutes)
    return Number.isInteger(n) && n >= INTERVAL_MINUTES.min && n <= INTERVAL_MINUTES.max
      ? { kind: 'interval', everyMinutes: n }
      : `Every ${INTERVAL_MINUTES.min} to ${INTERVAL_MINUTES.max} minutes.`
  }
  if (d.repeat === 'custom') return cronProblem(d.cron) ?? { kind: 'cron', expr: d.cron.trim(), preset: 'custom' }
  if (d.repeat === 'selected-days' && d.days.length === 0) return 'Pick at least one day.'
  return { kind: 'cron', expr: compileRepeat(d.repeat, start, timezone, d.days), preset: d.repeat }
}

/** Create or edit a routine: when, how often, which worktree and CLI, and what it does. */
export function RoutineEditor() {
  const target = useRoutineEditor((s) => s.target)
  return target ? <EditorDialog key={JSON.stringify(target)} target={target} /> : null
}

function EditorDialog({ target }: { target: Target }) {
  const close = useRoutineEditor((s) => s.close)
  const { routines, create: createRoutine, update, remove, runNow } = useRoutines()
  const allClis = useClis((s) => s.clis)
  const projects = useProjects((s) => s.projects)
  const workspaces = useWorkspaces((s) => s.byProject)
  const loadWorkspaces = useWorkspaces((s) => s.load)
  const routine = 'routineId' in target ? routines.find((r) => r.id === target.routineId) : undefined
  const [draft, setDraft] = useState<Draft>(() => {
    const d = draftOf(routine, target)
    // With one Workspace, a new schedule needs no Workspace pick (ADR 0062).
    const only = projects.length === 1 ? projects[0]!.id : ''
    return !routine && !d.projectId && only ? { ...d, projectId: only, workspaceId: mainWorkspaceId(only) } : d
  })
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [adding, setAdding] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const addFiles = async (picked: File[]): Promise<void> => {
    setAdding(true)
    for (const file of picked.slice(0, MAX_ROUTINE_FILES - draft.attachments.length)) {
      if (file.size > MAX_ROUTINE_FILE_BYTES) {
        reportError(new Error(`${file.name} is over ${MAX_ROUTINE_FILE_BYTES / 1024 / 1024} MB.`), 'Add file')
        continue
      }
      const copy = await runAction('Add file', async () => api('routines.addFile', { name: file.name, data: await base64Of(file) }))
      if (copy) setDraft((d) => ({ ...d, attachments: [...d.attachments, copy] }))
    }
    setAdding(false)
  }
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((d) => ({ ...d, [key]: value }))

  useEffect(() => {
    if (draft.projectId && !workspaces[draft.projectId]) void loadWorkspaces(draft.projectId)
  }, [draft.projectId, workspaces, loadWorkspaces])
  const cliOptions = allClis.filter((c) => c.available && c.kind !== 'shell').map((c) => ({ value: c.id, label: c.displayName }))
  const runsOn: RoutineTarget | undefined =
    draft.projectId && draft.workspaceId && draft.cliId ? { kind: 'workspace', projectId: draft.projectId, workspaceId: draft.workspaceId, cliId: draft.cliId } : undefined

  // Times are this computer's; a routine saved in another zone moves to this one when it is saved.
  const timezone = localZone()
  const start = new Date(`${draft.date}T${draft.time}`)
  const schedule = scheduleOf(draft, start, timezone)
  const endsAt = draft.endsDate ? new Date(`${draft.endsDate}T23:59:59`) : undefined
  let preview: Date[] = []
  if (typeof schedule !== 'string') {
    try {
      preview = nextRuns({ schedule, startsAt: start.toISOString(), timezone, ...(endsAt ? { endsAt: endsAt.toISOString() } : {}) }, new Date(), 3)
    } catch {
      preview = []
    }
  }
  const problem =
    typeof schedule === 'string'
      ? schedule
      : !draft.name.trim()
        ? 'Add a title.'
        : !draft.prompt.trim()
          ? 'Add instructions.'
          : !runsOn
            ? 'Pick the worktree and CLI.'
            : preview.length === 0
              ? draft.repeat === 'once'
                ? 'Pick a time in the future.'
                : 'This schedule has no runs left.'
              : null

  const save = async (): Promise<void> => {
    if (problem || typeof schedule === 'string' || !runsOn) return
    setBusy(true)
    const timeout = Number(draft.timeoutMinutes) || undefined
    const fields = { name: draft.name.trim(), prompt: draft.prompt.trim(), schedule, startsAt: start.toISOString(), timezone, target: runsOn, attachments: draft.attachments }
    const saved = routine
      ? await update(routine.id, { ...fields, endsAt: endsAt?.toISOString() ?? null, timeoutMinutes: timeout ?? null })
      : await createRoutine({ ...fields, ...(endsAt ? { endsAt: endsAt.toISOString() } : {}), ...(timeout ? { timeoutMinutes: timeout } : {}) })
    setBusy(false)
    if (saved) close()
  }

  const weekday = WEEKDAYS[Number.isNaN(start.getTime()) ? 0 : start.getDay()]
  const repeatOptions: Array<{ value: Repeat; label: string }> = [
    { value: 'once', label: 'Does not repeat' },
    { value: 'interval', label: 'Every X minutes' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekdays', label: 'Every weekday (Monday to Friday)' },
    { value: 'weekly', label: `Weekly on ${weekday}` },
    { value: 'selected-days', label: 'Selected weekdays' },
    { value: 'monthly', label: `Monthly on day ${Number.isNaN(start.getTime()) ? '' : start.getDate()}` },
    { value: 'month-end', label: 'Monthly on the last day' },
    { value: 'yearly', label: 'Yearly' },
    { value: 'custom', label: 'Custom cron (advanced)' }
  ]
  return (
    <>
      <Modal
        open={!confirmDelete}
        title={[routine ? 'Edit schedule' : 'New schedule', projects.find((p) => p.id === draft.projectId)?.name].filter(Boolean).join(' · ')}
        width="lg"
        onClose={close}
        footer={
          <>
            {routine && (
              <>
                <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
                <Button variant="ghost" icon={<Play />} onClick={() => void runNow(routine.id).then(close)}>
                  Run now
                </Button>
              </>
            )}
            <span className={styles.spacer} />
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={busy} disabled={problem !== null} title={problem ?? undefined}>
              {routine ? 'Save' : 'Save schedule'}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <TextField label="Title" value={draft.name} maxLength={MAX_ROUTINE_NAME} placeholder="Morning inbox report" onChange={(v) => set('name', v)} autoFocus />
          <div className={styles.row}>
            <label className={form.field}>
              <span className={form.fieldLabel}>Starts</span>
              <input className={form.input} type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
            </label>
            <label className={form.field}>
              <span className={form.fieldLabel}>At</span>
              <input className={form.input} type="time" value={draft.time} onChange={(e) => set('time', e.target.value)} />
            </label>
          </div>
          <Select label="Repeat" value={draft.repeat} options={repeatOptions} onChange={(v) => set('repeat', v as Repeat)} />
          {draft.repeat === 'interval' && (
            <TextField
              label="Every how many minutes"
              type="number"
              min={INTERVAL_MINUTES.min}
              max={INTERVAL_MINUTES.max}
              value={draft.everyMinutes}
              onChange={(v) => set('everyMinutes', v)}
            />
          )}
          {draft.repeat === 'selected-days' && (
            <div className={styles.days} role="group" aria-label="Days">
              {WEEKDAYS.map((name, day) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={draft.days.includes(day)}
                  className={cx(styles.day, draft.days.includes(day) && styles.dayOn)}
                  onClick={() => set('days', draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day])}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {draft.repeat === 'custom' && (
            <TextField label="Cron rule (minute hour day month weekday)" value={draft.cron} placeholder="0 9 * * 1-5" onChange={(v) => set('cron', v)} />
          )}
          <p className={cx(styles.note, problem && typeof schedule === 'string' && styles.problem)}>
            {typeof schedule === 'string'
              ? schedule
              : preview.length
                ? `Next: ${preview.map((d) => when(d.toISOString())).join(' · ')}`
                : 'No runs ahead.'}
            {routine && !sameZone(routine.timezone, timezone) ? ` Saved in ${routine.timezone}; saving moves it to ${timezone}.` : ''}
          </p>
          <p className={styles.note}>
            Runs while Hiveory is open on this computer (or on your Hiveory server). A run missed by less than 12 hours still happens when it is back.
          </p>
          <details className={styles.advanced}>
            <summary>Advanced · {draft.timeoutMinutes ? `stops after ${draft.timeoutMinutes} min` : 'no run limit'}</summary>
            <div className={styles.row}>
              <TextField label="Stop a run after (minutes)" type="number" min={1} max={1440} placeholder="No limit" value={draft.timeoutMinutes} onChange={(v) => set('timeoutMinutes', v)} />
              <label className={form.field}>
                <span className={form.fieldLabel}>Last day (optional)</span>
                <input className={form.input} type="date" value={draft.endsDate} onChange={(e) => set('endsDate', e.target.value)} />
              </label>
            </div>
          </details>
          {/* A routine belongs to its Workspace (ADR 0040): picked for a new one only, starting on its Primary (ADR 0062). */}
          {!routine && (
            <Select
              label="Workspace"
              value={draft.projectId}
              options={[{ value: '', label: 'Pick a workspace', disabled: true }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => setDraft((d) => ({ ...d, projectId: v, workspaceId: mainWorkspaceId(v) }))}
            />
          )}
          <Select
            label="Worktree"
            value={draft.workspaceId}
            options={[{ value: '', label: 'Pick a worktree', disabled: true }, ...(workspaces[draft.projectId] ?? []).map((w) => ({ value: w.id, label: w.name }))]}
            onChange={(v) => set('workspaceId', v)}
          />
          <Select label="CLI" value={draft.cliId} options={[{ value: '', label: 'Pick a CLI', disabled: true }, ...cliOptions]} onChange={(v) => set('cliId', v)} />
          <p className={styles.note}>
            Each run opens a new agent in that worktree and types these instructions once it is ready. Its card moves on the board by what it is doing, and it stays open when it is done.
          </p>
          <TextAreaField
            label="Instructions"
            value={draft.prompt}
            maxLength={MAX_ROUTINE_PROMPT}
            rows={6}
            placeholder="What to do on every run, where to look, and what to report. Keep anything irreversible for your approval."
            onChange={(v) => set('prompt', v)}
          />
          <div className={styles.files}>
            <AttachmentChips
              items={draft.attachments.map((a) => ({ key: a.path, name: a.name, kind: a.kind, size: a.size }))}
              onRemove={(key) => set('attachments', draft.attachments.filter((a) => a.path !== key))}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={<Paperclip />}
              loading={adding}
              disabled={draft.attachments.length >= MAX_ROUTINE_FILES}
              onClick={() => fileRef.current?.click()}
            >
              {draft.attachments.length ? 'Add another file' : 'Add files for every run'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            <span className={styles.note}>
              Up to {MAX_ROUTINE_FILES} files, {MAX_ROUTINE_FILE_BYTES / 1024 / 1024} MB each. Hiveory keeps a copy, so each run gets them even if the originals move.
            </span>
          </div>
        </div>
      </Modal>
      {routine && (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete "${routine.name}"?`}
          confirmLabel="Delete schedule"
          danger
          onConfirm={() => void remove(routine.id).then(close)}
          onClose={() => setConfirmDelete(false)}
        >
          Its future runs stop. The run log and the agents it opened stay.
        </ConfirmDialog>
      )}
    </>
  )
}
