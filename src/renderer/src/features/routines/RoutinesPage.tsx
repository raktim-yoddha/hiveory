import { useEffect, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { RoutineRun, RoutineTarget, RoutineView } from '@shared/domain/routine'
import { Button, IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Popover } from '../../components/ui/Popover'
import { Tabs } from '../../components/ui/Tabs'
import { Toggle } from '../../components/ui/Toggle'
import { useSettings, useWorkspaces } from '../../stores/data'
import { useRoutines } from '../../stores/routines'
import chat from '../chat/Chat.module.css'
import { useRoutineEditor } from './RoutineEditor'
import { RoutineRow } from './RoutineRow'
import { RunLog } from './RunLog'
import { useDoerName } from './use-doer'
import { WeekCalendar } from './WeekCalendar'
import { MiniMonth } from './MiniMonth'
import { busyDays, dayKey, startOfDay, weekStartOf } from './calendar-dates'
import styles from './Routines.module.css'

type View = 'day' | 'week' | 'list' | 'runs'
const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'list', label: 'List' },
  { value: 'runs', label: 'Run logs' }
]
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Whose schedules a Schedules page shows: one Workspace's, opened from one of its Worktrees (ADR 0040, 0055). */
export interface ScheduleScope {
  projectId: string
  workspaceId: string
}

const NO_WORKTREES: Array<{ id: string }> = []

/**
 * A Workspace's schedules on a day (or week) calendar, or as a list, with the run log and the
 * keep-awake switch (ADR 0055). It lives in the side panel's Schedules tab.
 */
export function RoutinesPage({ scope }: { scope: ScheduleScope }) {
  const { routines, runs, loaded, load } = useRoutines()
  const worktrees = useWorkspaces((s) => s.byProject[scope.projectId] ?? NO_WORKTREES)
  const open = useRoutineEditor((s) => s.open)
  const settings = useSettings((s) => s.settings)
  const updateSettings = useSettings((s) => s.update)
  // The side panel is narrow: Work opens on one day.
  const [view, setView] = useState<View>('day')
  /** The day the calendar is on: its week in Week view, itself in Day view. */
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const inScope = (r: RoutineView): boolean => worktrees.some((w) => w.id === r.target.workspaceId)
  const shown = routines.filter(inScope)
  const isMine = (run: RoutineRun): boolean => shown.some((r) => r.id === run.routineId)
  // A new schedule (or a click on an empty hour) is for the open Worktree.
  const target: RoutineTarget = { kind: 'workspace', projectId: scope.projectId, workspaceId: scope.workspaceId, cliId: '' }
  const create = (startsAt?: string): void => open({ target, startsAt })
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
    <section className={styles.embedded} aria-label="Schedules">
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
          onSlot={(at) => create(at.toISOString())}
          onOpen={(routineId) => open({ routineId })}
        />
      ) : view === 'list' ? (
        shown.length === 0 ? (
          <EmptyState
            icon={<CalendarClock />}
            title="No schedules yet"
            description="Have an agent check dependencies every Monday, run the tests each night, or review open work every morning."
          />
        ) : (
          <ul className={styles.list}>
            {shown.map((r) => (
              <RoutineRow key={r.id} routine={r} who={doer(r)} />
            ))}
          </ul>
        )
      ) : (
        <div className={styles.scroll}>
          <RunLog only={isMine} />
        </div>
      )}
    </section>
  )
}
