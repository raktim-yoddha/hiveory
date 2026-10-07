import { useEffect, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Popover } from '../../components/ui/Popover'
import { Select } from '../../components/ui/Select'
import { Tabs } from '../../components/ui/Tabs'
import { Toggle } from '../../components/ui/Toggle'
import { useBots } from '../../stores/bots'
import { useSettings } from '../../stores/data'
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
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Every routine (bots', scheduled chats and Work's) on a week calendar (or as a list), with the run log and the keep-awake switch. */
export function RoutinesPage() {
  const { routines, runs, loaded, load } = useRoutines()
  const { bots, routinesFilter, showRoutines } = useBots()
  const open = useRoutineEditor((s) => s.open)
  const settings = useSettings((s) => s.settings)
  const updateSettings = useSettings((s) => s.update)
  const [view, setView] = useState<View>('week')
  /** The day the calendar is on: its week in Week view, itself in Day view. */
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const shown = routinesFilter ? routines.filter((r) => r.botId === routinesFilter) : routines
  const shownRuns = routinesFilter ? runs.filter((r) => r.botId === routinesFilter) : runs
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
    <section className={chat.surface} aria-label="Routines">
      <header className={styles.pageHeader}>
        <h1 className={chat.chatHeading}>Routines</h1>
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
        <Tabs label="Routines view" options={VIEWS} value={view} onChange={setView} variant="segmented" />
        <Select
          label="Bot"
          hideLabel
          size="sm"
          value={routinesFilter ?? ''}
          options={[{ value: '', label: 'All routines' }, ...bots.map((b) => ({ value: b.id, label: b.name }))]}
          onChange={(v) => showRoutines(v || undefined)}
        />
        <Button variant="primary" icon={<Plus />} onClick={() => open({ botId: routinesFilter })}>
          New routine
        </Button>
      </header>
      <div className={styles.awake}>
        <span>
          <strong>Keep this computer awake for routines.</strong> Holds it awake for the hour before a routine and while one runs, while plugged in. A closed lid
          still sleeps.
        </span>
        <Toggle label="Keep this computer awake for routines" checked={settings.keepAwakeForRoutines} onChange={(keepAwakeForRoutines) => void updateSettings({ keepAwakeForRoutines })} />
      </div>
      {view === 'week' || view === 'day' ? (
        <WeekCalendar
          key={view}
          start={view === 'day' ? anchor : weekStart}
          dayCount={view === 'day' ? 1 : 7}
          routines={shown}
          runs={shownRuns}
          onSlot={(at, botId) => open({ botId: botId ?? routinesFilter, startsAt: at.toISOString() })}
          onOpen={(routineId) => open({ routineId })}
        />
      ) : view === 'list' ? (
        shown.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title="No routines yet" description="Give a bot, a new chat or a Work agent a job to do every morning, every hour or once next week." />
        ) : (
          <ul className={styles.list}>
            {shown.map((r) => (
              <RoutineRow key={r.id} routine={r} botName={routinesFilter ? undefined : doer(r)} />
            ))}
          </ul>
        )
      ) : (
        <div className={styles.scroll}>
          <RunLog botId={routinesFilter} />
        </div>
      )}
    </section>
  )
}
