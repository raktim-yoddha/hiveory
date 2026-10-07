import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { RoutineRun, RoutineView } from '@shared/domain/routine'
import { nextRuns } from '@shared/domain/routine-schedule'
import { cx } from '../../lib/cx'
import { BOT_DRAG_TYPE } from '../bots/bot-drag'
import { DAY_MS, sameDay } from './calendar-dates'
import { WEEKDAYS } from './routine-text'
import styles from './Routines.module.css'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
// ponytail: a routine every 5 minutes would draw 2,000 blocks a week; it shows its first ones only.
const MAX_PER_ROUTINE = 200

interface Item {
  key: string
  routineId: string
  name: string
  at: Date
  status?: RoutineRun['status']
}

/**
 * A week (or one day) of routines: past runs from the log (by outcome), upcoming runs from each
 * schedule. Click an empty hour to add one there; drop a bot from the sidebar on it to add one for that bot.
 */
export function WeekCalendar({
  start,
  dayCount = 7,
  routines,
  runs,
  onSlot,
  onOpen
}: {
  start: Date
  dayCount?: 1 | 7
  routines: RoutineView[]
  runs: RoutineRun[]
  onSlot: (at: Date, botId?: string) => void
  onOpen: (routineId: string) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState<string | null>(null)
  const now = new Date()
  const days = Array.from({ length: dayCount }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  const end = days.at(-1)!.getTime() + DAY_MS

  const items: Item[] = []
  for (const run of runs) {
    const at = new Date(run.scheduledFor)
    if (at >= start && at.getTime() < end) items.push({ key: run.id, routineId: run.routineId, name: run.routineName, at, status: run.status })
  }
  const from = new Date(Math.max(start.getTime(), now.getTime()))
  for (const r of routines) {
    if (!r.enabled) continue
    for (const at of nextRuns(r, from, MAX_PER_ROUTINE)) {
      if (at.getTime() >= end) break
      items.push({ key: `${r.id}:${at.getTime()}`, routineId: r.id, name: r.name, at })
    }
  }

  // Opens on the working day, not at midnight.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = (el.scrollHeight / 24) * 7
  }, [])

  const dropOn = (at: Date) => ({
    onDragOver: (e: DragEvent<HTMLButtonElement>) => {
      if (!e.dataTransfer.types.includes(BOT_DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setOver(at.toISOString())
    },
    onDragLeave: () => setOver((o) => (o === at.toISOString() ? null : o)),
    onDrop: (e: DragEvent<HTMLButtonElement>) => {
      const botId = e.dataTransfer.getData(BOT_DRAG_TYPE)
      setOver(null)
      if (!botId) return
      e.preventDefault()
      onSlot(at, botId)
    }
  })

  return (
    <div className={cx(styles.week, dayCount === 1 && styles.oneDay)}>
      <div className={styles.weekHead}>
        <span className={styles.zone} title={Intl.DateTimeFormat().resolvedOptions().timeZone}>
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
        {days.map((d) => (
          <span key={d.toISOString()} className={cx(styles.dayHead, sameDay(d, now) && styles.today)}>
            <span className={styles.dayName}>{WEEKDAYS[d.getDay()]}</span>
            <span className={styles.dayNumber}>{d.getDate()}</span>
          </span>
        ))}
      </div>
      <div ref={scroller} className={styles.weekBody}>
        <div className={styles.hours} aria-hidden>
          {HOURS.map((h) => (
            <span key={h} className={styles.hourLabel}>
              {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d.toISOString()} className={cx(styles.dayColumn, sameDay(d, now) && styles.todayColumn)}>
            {HOURS.map((h) => {
              const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h)
              return (
                <button
                  key={h}
                  type="button"
                  className={cx(styles.slot, over === at.toISOString() && styles.slotOver)}
                  aria-label={`New routine ${WEEKDAYS[d.getDay()]} ${d.getDate()} at ${String(h).padStart(2, '0')}:00`}
                  onClick={() => onSlot(at)}
                  {...dropOn(at)}
                />
              )
            })}
            {stacked(items.filter((it) => sameDay(it.at, d))).map(({ item: it, index, size }) => (
              <button
                key={it.key}
                type="button"
                className={cx(styles.event, it.status && styles[it.status])}
                style={{
                  top: `calc(var(--calendar-hour-height) * ${it.at.getHours() + it.at.getMinutes() / 60})`,
                  left: `calc(${(index / size) * 100}% + var(--space-2))`,
                  width: `calc(${100 / size}% - var(--space-2) * 2)`
                }}
                title={`${it.name} · ${pad(it.at)}${it.status ? ` · ${it.status}` : ''}`}
                onClick={() => onOpen(it.routineId)}
              >
                <span className={styles.eventTime}>{pad(it.at)}</span> {it.name}
              </button>
            ))}
            {sameDay(d, now) && <span className={styles.nowLine} style={{ top: `calc(var(--calendar-hour-height) * ${now.getHours() + now.getMinutes() / 60})` }} aria-hidden />}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Runs in the same half hour sit side by side instead of on top of each other. */
const stacked = (items: Item[]): Array<{ item: Item; index: number; size: number }> => {
  const slot = (it: Item): number => it.at.getHours() * 2 + Math.floor(it.at.getMinutes() / 30)
  const sorted = [...items].sort((a, b) => a.at.getTime() - b.at.getTime() || a.name.localeCompare(b.name))
  return sorted.map((item) => {
    const same = sorted.filter((other) => slot(other) === slot(item))
    return { item, index: same.indexOf(item), size: same.length }
  })
}

const pad = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
