import { useEffect, useState } from 'react'
import { CalendarClock, FileText, Plus } from 'lucide-react'
import type { BotView } from '@shared/domain/bot'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Toggle } from '../../components/ui/Toggle'
import { useBots } from '../../stores/bots'
import { useRoutines } from '../../stores/routines'
import { useRoutineEditor } from '../routines/RoutineEditor'
import { RoutineRow } from '../routines/RoutineRow'
import { RunLog } from '../routines/RunLog'
import routines from '../routines/Routines.module.css'
import styles from './Bots.module.css'

/** The bot panel's Routines tab: this bot's schedules, its run log, and the way to the calendar. */
export function RoutinesTab({ bot }: { bot: BotView }) {
  const { routines: all, loaded, load } = useRoutines()
  const { update, showRoutines } = useBots()
  const open = useRoutineEditor((s) => s.open)
  const [logs, setLogs] = useState(false)
  const mine = all.filter((r) => r.botId === bot.id)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  return (
    <div className={styles.tabBody}>
      <section className={styles.card} aria-label={`${bot.name}'s routines`}>
        <div className={routines.cardHead}>
          <h3 className={styles.cardTitle}>Routines</h3>
          <span className={routines.count}>{mine.length}</span>
        </div>
        {!bot.routines && (
          <div className={routines.allow}>
            <span>{bot.name} doesn&rsquo;t run on a schedule yet.</span>
            <Toggle label={`Allow ${bot.name} to run on a schedule`} checked={false} onChange={() => void update(bot.id, { routines: true })} />
          </div>
        )}
        <div className={styles.rowEnd}>
          <Button variant="ghost" icon={<FileText />} onClick={() => setLogs(!logs)} aria-pressed={logs}>
            Run logs
          </Button>
          <Button variant="primary" icon={<Plus />} onClick={() => open({ botId: bot.id })} disabled={!bot.routines}>
            Create schedule
          </Button>
        </div>
      </section>
      {logs ? (
        <RunLog botId={bot.id} />
      ) : mine.length ? (
        <ul className={routines.list}>
          {mine.map((r) => (
            <RoutineRow key={r.id} routine={r} />
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={<CalendarClock />} title="No schedules yet." description={`Give ${bot.name} work to do every morning, every hour, or once next week.`} />
      )}
      <Button variant="ghost" onClick={() => showRoutines(bot.id)}>
        Open schedules →
      </Button>
    </div>
  )
}
