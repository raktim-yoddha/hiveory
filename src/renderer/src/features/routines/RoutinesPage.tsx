import { useEffect, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { isWorkRoutine, type RoutineRun, type RoutineTarget, type RoutineView } from '@shared/domain/routine'
import { Button, IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Popover } from '../../components/ui/Popover'
import { Select } from '../../components/ui/Select'
import { Tabs } from '../../components/ui/Tabs'
import { Toggle } from '../../components/ui/Toggle'
import { useBots } from '../../stores/bots'
import { useSettings, useWorkspaces } from '../../stores/data'
import { useRoutines } from '../../stores/routines'
import { useRoutineEditor } from './RoutineEditor'
import { RoutineRow } from './RoutineRow'
import { RunLog } from './RunLog'
import { useDoerName } from './use-doer'
import { WeekCalendar } from './WeekCalendar'
import { MiniMonth } from './MiniMonth'
import { busyDays, dayKey, startOfDay, weekStartOf } from './calendar-dates'
import chat from '../chat/Chat.module.css'
import styles from './Routines.module.css'

type View = 'day' | 'week' | 'list' | 'runs'
const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'list', label: 'List' },
  { value: 'runs', label: 'Run logs' }
]
const EMPTY_TEXT: Record<ScheduleScope['kind'], string> = {
  bots: 'Give a bot or a new chat a job to do every morning, every hour or once next week.',
  chat: 'Start a new chat on its own every morning, every hour or once next week.',
  work: 'Have an agent check dependencies every Monday, run the tests each night, or review open work every morning.'
}
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Whose schedules a Schedules page shows: Bots' (and scheduled chats), Chat's, or one Workspace's in Work (ADR 0040, 0055). */
export type ScheduleScope = { kind: 'bots' } | { kind: 'chat' } | { kind: 'work'; projectId: string; workspaceId: string }

const BOTS: ScheduleScope = { kind: 'bots' }
const NO_WORKTREES: Array<{ id: string }> = []

/**
 * Schedules on a week (or day) calendar, or as a list, with the run log and the keep-awake switch.
 * Bots shows bots' schedules and scheduled chats, Chat its scheduled chats, Work a Workspace's (ADR 0055).
 */
export function RoutinesPage({ scope = BOTS }: { scope?: ScheduleScope }) {
  const { routines, runs, loaded, load } = useRoutines()
  const { bots, routinesFilter: botFilter, showRoutines } = useBots()
  const worktrees = useWorkspaces((s) => (scope.kind === 'work' ? (s.byProject[scope.projectId] ?? NO_WORKTREES) : NO_WORKTREES))
  const open = useRoutineEditor((s) => s.open)
  const settings = useSettings((s) => s.settings)
  const updateSettings = useSettings((s) => s.update)
  // The side panel is narrow: Work opens on one day.
  const [view, setView] = useState<View>(scope.kind === 'work' ? 'day' : 'week')
  const routinesFilter = scope.kind === 'bots' ? botFilter : undefined
  /** The day the calendar is on: its week in Week view, itself in Day view. */
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const inScope = (r: RoutineView): boolean =>
    scope.kind === 'chat'
      ? r.target?.kind === 'chat'
      : scope.kind === 'work'
        ? isWorkRoutine(r) && worktrees.some((w) => w.id === r.target.workspaceId)
        : !isWorkRoutine(r) && (!routinesFilter || r.botId === routinesFilter)
  const shown = routines.filter(inScope)
  const isMine = (run: RoutineRun): boolean =>
    shown.some((r) => r.id === run.routineId) ||
    (scope.kind === 'bots' && (routinesFilter ? run.botId === routinesFilter : !run.agentId && !routines.some((r) => r.id === run.routineId && isWorkRoutine(r)))) ||
    (scope.kind === 'chat' && !run.botId && !run.agentId && !routines.some((r) => r.id === run.routineId))
  // What a new schedule (or a click on an empty hour) is for here.
  const target: RoutineTarget | undefined =
    scope.kind === 'chat' ? { kind: 'chat', cliId: '' } : scope.kind === 'work' ? { kind: 'workspace', projectId: scope.projectId, workspaceId: scope.workspaceId, cliId: '' } : undefined
  const create = (startsAt?: string, botId?: string): void => open(target ? { target, startsAt } : { botId: botId ?? routinesFilter, startsAt })
  const shownRuns = runs.filter(isMine)
  const weekStart = weekStartOf(anchor)
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)
  const range =
    view === 'day'
      ? `${DAY_NAMES[anchor.getDay()]}, ${MONTHS[anchor.getMonth()]} ${anchor.getDate()}, ${anchor.getFullYear()}`
      : `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} – ${weekEnd.getMonth() === weekStart.getMonth() ? '' : `${MONTHS[weekEnd.getMonth()]} `}${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
  const step = view === 'day' ? 1 : 7
  const move = (n: number): void => setAnchor((a) => new Date(a.getFullYear(), a.getMonth(), a.getDate() + n * step))
  // The mini month's dots: days ahead with a run, over the three months around the anchor.
  const busy = busyDays(shown, new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1), new Date(anchor.getFullYear(), anchor.getMonth() + 2, 1))
  const doer = useDoerName()

  return (
    <section className={scope.kind === 'work' ? styles.embedded : chat.surface} aria-label="Schedules">
      <header className={styles.pageHeader}>
        <h1 className={chat.chatHeading}>Schedules</h1>
        {(view === 'week' || view === 'day') && (
          <div className={styles.weekNav}>
            <IconButton label={`Previous ${view}`} icon={<ChevronLeft />} onClick={() => move(-1)} />
            <IconButton label={`Next ${view}`} icon={<ChevronRight />} onClick={() => move(1)} />
            <Popover
              label="Pick a date"
              trigger={(props) => (
                <button type="button" {...props} className={styles.range} title="Pick a date">
                  {range}
                </button>
              )}
            >
              {(close) => (
                <MiniMonth
                  value={anchor}
                  busy={(d) => busy.has(dayKey(d))}
                  onPick={(d) => {
                    setAnchor(startOfDay(d))
                    close()
                  }}
                />
              )}
            </Popover>
            <Button size="sm" variant="ghost" onClick={() => setAnchor(startOfDay(new Date()))}>
              Today
            </Button>
          </div>
        )}
        <span className={styles.spacer} />
        <Tabs label="Schedules view" options={VIEWS} value={view} onChange={setView} variant="segmented" />
        {scope.kind === 'bots' && (
          <Select
            label="Bot"
            hideLabel
            size="sm"
            value={routinesFilter ?? ''}
            options={[{ value: '', label: 'All schedules' }, ...bots.map((b) => ({ value: b.id, label: b.name }))]}
            onChange={(v) => showRoutines(v || undefined)}
          />
        )}
        <Button variant="primary" icon={<Plus />} onClick={() => create()}>
          New schedule
        </Button>
      </header>
      <div className={styles.awake}>
        <span>
          <strong>Keep this computer awake for schedules.</strong> Holds it awake for the hour before a scheduled run and while one runs, while plugged in. A closed lid
          still sleeps.
        </span>
        <Toggle label="Keep this computer awake for schedules" checked={settings.keepAwakeForRoutines} onChange={(keepAwakeForRoutines) => void updateSettings({ keepAwakeForRoutines })} />
      </div>
      {view === 'week' || view === 'day' ? (
        <WeekCalendar
          key={view}
          start={view === 'day' ? anchor : weekStart}
          dayCount={view === 'day' ? 1 : 7}
          routines={shown}
          runs={shownRuns}
          onSlot={(at, botId) => create(at.toISOString(), botId)}
          onOpen={(routineId) => open({ routineId })}
        />
      ) : view === 'list' ? (
        shown.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title="No schedules yet" description={EMPTY_TEXT[scope.kind]} />
        ) : (
          <ul className={styles.list}>
            {shown.map((r) => (
              <RoutineRow key={r.id} routine={r} who={routinesFilter ? undefined : doer(r)} />
            ))}
          </ul>
        )
      ) : (
        <div className={styles.scroll}>
          <RunLog botId={routinesFilter} only={isMine} />
        </div>
      )}
    </section>
  )
}
