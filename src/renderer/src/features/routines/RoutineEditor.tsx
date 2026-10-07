import { useEffect, useState } from 'react'
import { Play, Trash2 } from 'lucide-react'
import { create } from 'zustand'
import { INTERVAL_MINUTES, MAX_ROUTINE_NAME, MAX_ROUTINE_PROMPT, type RepeatPreset, type RoutineSchedule, type RoutineTarget, type RoutineView } from '@shared/domain/routine'
import { compileRepeat, cronProblem, nextRuns } from '@shared/domain/routine-schedule'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { TextAreaField, TextField } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { cx } from '../../lib/cx'
import { useBots } from '../../stores/bots'
import { useChat } from '../../stores/chat'
import { useClis, useProjects, useWorkspaces } from '../../stores/data'
import { useRoutines } from '../../stores/routines'
import { cronDays, localZone, sameZone, when, WEEKDAYS } from './routine-text'
import form from '../../components/ui/form.module.css'
import styles from './Routines.module.css'

type Target = { routineId: string } | { botId?: string; startsAt?: string; target?: RoutineTarget }

/** What the editor is open for: a routine, a new one (maybe for a bot or a time), or nothing. */
export const useRoutineEditor = create<{ target: Target | null; open(target: Target): void; close(): void }>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null })
}))

type Repeat = 'once' | 'interval' | RepeatPreset

type Doer = 'bot' | 'chat' | 'workspace'

interface Draft {
  name: string
  /** Who does it (ADR 0030): a bot, a new chat or an agent in Work. */
  doer: Doer
  botId: string
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
  /** 'dedicated' · 'none' · a thread id */
  results: string
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

const draftOf = (routine: RoutineView | undefined, target: Target, firstBot: string): Draft => {
  const start = new Date(routine?.startsAt ?? ('startsAt' in target && target.startsAt ? target.startsAt : nextHour().toISOString()))
  const s = routine?.schedule
  const doing = routine ? routine.target : 'target' in target ? target.target : undefined
  return {
    name: routine?.name ?? '',
    doer: doing?.kind ?? 'bot',
    botId: routine?.botId ?? ('botId' in target && target.botId ? target.botId : firstBot),
    cliId: doing?.cliId ?? '',
    projectId: doing?.kind === 'workspace' ? doing.projectId : '',
    workspaceId: doing?.kind === 'workspace' ? doing.workspaceId : '',
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
    results: routine?.results === 'none' ? 'none' : (routine?.resultsThreadId ?? 'dedicated')
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

/** Create or edit a routine: when, how often, which bot, what it does, and where its results go. */
export function RoutineEditor() {
  const target = useRoutineEditor((s) => s.target)
  return target ? <EditorDialog key={JSON.stringify(target)} target={target} /> : null
}

function EditorDialog({ target }: { target: Target }) {
  const close = useRoutineEditor((s) => s.close)
  const { routines, create: createRoutine, update, remove, runNow } = useRoutines()
  const { bots, threads, loadThreads, update: updateBot } = useBots()
  const allClis = useClis((s) => s.clis)
  const chatClis = useChat((s) => s.clis)
  const loadChatClis = useChat((s) => s.loadClis)
  const projects = useProjects((s) => s.projects)
  const workspaces = useWorkspaces((s) => s.byProject)
  const loadWorkspaces = useWorkspaces((s) => s.load)
  const routine = 'routineId' in target ? routines.find((r) => r.id === target.routineId) : undefined
  const [draft, setDraft] = useState<Draft>(() => draftOf(routine, target, bots[0]?.id ?? ''))
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((d) => ({ ...d, [key]: value }))

  const bot = draft.doer === 'bot' ? bots.find((b) => b.id === draft.botId) : undefined
  const botThreads = threads[draft.botId]
  useEffect(() => {
    if (draft.doer === 'bot' && draft.botId && !botThreads) void loadThreads(draft.botId)
  }, [draft.doer, draft.botId, botThreads, loadThreads])
  useEffect(() => {
    if (draft.doer === 'chat' && chatClis.length === 0) void loadChatClis()
  }, [draft.doer, chatClis.length, loadChatClis])
  useEffect(() => {
    if (draft.doer === 'workspace' && draft.projectId && !workspaces[draft.projectId]) void loadWorkspaces(draft.projectId)
  }, [draft.doer, draft.projectId, workspaces, loadWorkspaces])
  const cliOptions = (draft.doer === 'chat' ? allClis.filter((c) => chatClis.includes(c.id)) : allClis.filter((c) => c.available && c.kind !== 'shell')).map((c) => ({
    value: c.id,
    label: c.displayName
  }))
  const runsOn: RoutineTarget | undefined =
    draft.doer === 'chat' && draft.cliId
      ? { kind: 'chat', cliId: draft.cliId }
      : draft.doer === 'workspace' && draft.projectId && draft.workspaceId && draft.cliId
        ? { kind: 'workspace', projectId: draft.projectId, workspaceId: draft.workspaceId, cliId: draft.cliId }
        : undefined

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
          : draft.doer !== 'bot' && !runsOn
            ? draft.doer === 'chat'
              ? 'Pick the CLI for the chat.'
              : 'Pick the project, workspace and CLI.'
            : draft.doer === 'bot' && !bot
            ? 'Assign a bot.'
            : bot && !bot.routines
              ? `Allow ${bot!.name} to run on a schedule.`
              : preview.length === 0
                ? draft.repeat === 'once'
                  ? 'Pick a time in the future.'
                  : 'This schedule has no runs left.'
                : null

  const save = async (): Promise<void> => {
    if (problem || typeof schedule === 'string') return
    setBusy(true)
    const results = draft.results === 'none' ? ('none' as const) : ('thread' as const)
    const thread = draft.results !== 'none' && draft.results !== 'dedicated' ? draft.results : undefined
    const timeout = Number(draft.timeoutMinutes) || undefined
    const fields = { name: draft.name.trim(), prompt: draft.prompt.trim(), schedule, startsAt: start.toISOString(), timezone, results }
    const doer = runsOn ? { target: runsOn } : { botId: draft.botId }
    const saved = routine
      ? await update(routine.id, {
          ...fields,
          ...(runsOn ? { target: runsOn, botId: null } : { botId: draft.botId, target: null }),
          endsAt: endsAt?.toISOString() ?? null,
          timeoutMinutes: timeout ?? null,
          resultsThreadId: thread ?? null
        })
      : await createRoutine({
          ...fields,
          ...doer,
          ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
          ...(timeout ? { timeoutMinutes: timeout } : {}),
          ...(thread ? { resultsThreadId: thread } : {})
        })
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
  const resultOptions = [
    { value: 'dedicated', label: 'A dedicated results thread' },
    ...(botThreads ?? []).map((t) => ({ value: t.id, label: `The thread "${t.title}"`, group: 'Post into a thread' })),
    { value: 'none', label: "Only each run's own thread", group: '' }
  ]
  if (draft.results !== 'dedicated' && draft.results !== 'none' && !resultOptions.some((o) => o.value === draft.results)) {
    resultOptions.splice(1, 0, { value: draft.results, label: 'Its results thread' })
  }

  return (
    <>
      <Modal
        open={!confirmDelete}
        title={routine ? 'Edit routine' : 'New routine'}
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
              {routine ? 'Save' : 'Schedule routine'}
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
          <Select
            label="Who does it"
            value={draft.doer === 'bot' ? draft.botId : draft.doer}
            options={[
              ...bots.map((b) => ({ value: b.id, label: b.name, group: 'A bot' })),
              { value: 'chat', label: 'A new chat (Chat mode)', group: 'Without a bot' },
              { value: 'workspace', label: 'A new agent in a Work workspace', group: 'Without a bot' }
            ]}
            onChange={(v) => (v === 'chat' || v === 'workspace' ? setDraft((d) => ({ ...d, doer: v, cliId: '' })) : setDraft((d) => ({ ...d, doer: 'bot', botId: v })))}
          />
          {draft.doer === 'workspace' && (
            <div className={styles.row}>
              <Select
                label="Project"
                value={draft.projectId}
                options={[{ value: '', label: 'Pick a project', disabled: true }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                onChange={(v) => setDraft((d) => ({ ...d, projectId: v, workspaceId: '' }))}
              />
              <Select
                label="Workspace"
                value={draft.workspaceId}
                options={[{ value: '', label: 'Pick a workspace', disabled: true }, ...(workspaces[draft.projectId] ?? []).map((w) => ({ value: w.id, label: w.name }))]}
                onChange={(v) => set('workspaceId', v)}
              />
            </div>
          )}
          {draft.doer !== 'bot' && (
            <>
              <Select label="CLI" value={draft.cliId} options={[{ value: '', label: 'Pick a CLI', disabled: true }, ...cliOptions]} onChange={(v) => set('cliId', v)} />
              <p className={styles.note}>
                {draft.doer === 'chat'
                  ? 'Each run starts a new chat in Chat mode and sends these instructions. It works read-only, like any new chat.'
                  : 'Each run opens a new agent in that workspace and types these instructions once it is ready. Its card moves on the board by what it is doing, and it stays open when it is done.'}
              </p>
            </>
          )}
          {bot && !bot.routines && (
            <div className={styles.allow}>
              <span>{bot.name} doesn&rsquo;t run on a schedule yet.</span>
              <Toggle label={`Allow ${bot.name} to run on a schedule`} checked={false} onChange={() => void updateBot(bot.id, { routines: true })} />
            </div>
          )}
          {draft.doer === 'bot' && (
            <>
              <Select label="Post results to" value={draft.results} options={resultOptions} onChange={(v) => set('results', v)} />
              <p className={styles.note}>Each run starts with fresh context in its own thread; a dated summary of each run collects in the results thread.</p>
            </>
          )}
          <TextAreaField
            label="Instructions"
            value={draft.prompt}
            maxLength={MAX_ROUTINE_PROMPT}
            rows={6}
            placeholder="What to do on every run, where to look, and what to report. Keep anything irreversible for your approval."
            onChange={(v) => set('prompt', v)}
          />
        </div>
      </Modal>
      {routine && (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete "${routine.name}"?`}
          confirmLabel="Delete routine"
          danger
          onConfirm={() => void remove(routine.id).then(close)}
          onClose={() => setConfirmDelete(false)}
        >
          Its future runs stop. The run log and the threads it made stay.
        </ConfirmDialog>
      )}
    </>
  )
}
