import { useEffect, useRef } from 'react'
import type { RoutineRun, RoutineView } from '@shared/domain/routine'
import { nextRuns } from '@shared/domain/routine-schedule'
import { cx } from '../../lib/cx'
import { WEEKDAYS } from './routine-text'
import styles from './Routines.module.css'

const DAY_MS = 24 * 60 * 60 * 1000
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

/** Monday 00:00 of the week holding `day`, in this computer's time. */
export const weekStartOf = (day: Date): Date => {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

/** A week of routines: past runs from the log (by outcome), upcoming runs from each schedule. Click an empty hour to add one. */
export function WeekCalendar({
  weekStart,
  routines,
  runs,
  onSlot,
  onOpen
}: {
  weekStart: Date
  routines: RoutineView[]
  runs: RoutineRun[]
  onSlot: (at: Date) => void
  onOpen: (routineId: string) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const now = new Date()
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i))
  const end = days[6]!.getTime() + DAY_MS

  const items: Item[] = []
  for (const run of runs) {
    const at = new Date(run.scheduledFor)
    if (at >= weekStart && at.getTime() < end) items.push({ key: run.id, routineId: run.routineId, name: run.routineName, at, status: run.status })
  }
  const from = new Date(Math.max(weekStart.getTime(), now.getTime()))
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

  return (
    <div className={styles.week}>
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
                  className={styles.slot}
                  aria-label={`New routine ${WEEKDAYS[d.getDay()]} ${d.getDate()} at ${String(h).padStart(2, '0')}:00`}
                  onClick={() => onSlot(at)}
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

const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const pad = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
