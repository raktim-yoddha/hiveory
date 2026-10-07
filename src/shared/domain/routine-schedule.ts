import { Cron } from 'croner'
import type { RepeatPreset, Routine, RoutineSchedule } from './routine'

/** One date engine for the editor's preview and the scheduler (ADR 0028). */

type Timing = Pick<Routine, 'schedule' | 'startsAt' | 'timezone' | 'endsAt'>

/** The wall-clock fields of `at` in `timezone`. */
export function wallClock(at: Date, timezone: string): { minute: number; hour: number; day: number; month: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  )
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? '')
  return { minute: Number(parts.minute), hour: Number(parts.hour), day: Number(parts.day), month: Number(parts.month), weekday }
}

/** The cron rule an editor preset means, at the wall-clock time of `startsAt`. */
export function compileRepeat(preset: Exclude<RepeatPreset, 'custom'>, startsAt: Date, timezone: string, days: number[] = []): string {
  const w = wallClock(startsAt, timezone)
  const at = `${w.minute} ${w.hour}`
  switch (preset) {
    case 'daily':
      return `${at} * * *`
    case 'weekdays':
      return `${at} * * 1-5`
    case 'weekly':
      return `${at} * * ${w.weekday}`
    case 'selected-days':
      return `${at} * * ${[...new Set(days.filter((d) => d >= 0 && d <= 6))].sort().join(',') || w.weekday}`
    case 'monthly':
      return `${at} ${w.day} * *`
    case 'month-end':
      return `${at} L * *`
    case 'yearly':
      return `${at} ${w.day} ${w.month} *`
  }
}

/** Whether `timezone` is a zone this runtime knows. */
export function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/** Why a cron rule can't be used, or null. Five fields only: no seconds, years or @macros. */
export function cronProblem(expr: string): string | null {
  const text = expr.trim()
  if (text.startsWith('@')) return 'Use five fields (minute hour day month weekday), not a @shortcut.'
  if (text.split(/\s+/).length !== 5) return 'Use five fields: minute hour day-of-month month day-of-week.'
  try {
    new Cron(text, { mode: '5-part' })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'That cron rule is not valid.'
  }
}

// No croner `startAt`: it leaves out a run at exactly the start, which is the first run a user picks.
// The start is applied below instead.
const cronOf = (schedule: Extract<RoutineSchedule, { kind: 'cron' }>, t: Timing): Cron => new Cron(schedule.expr, { mode: '5-part', timezone: t.timezone })

const intervalMs = (schedule: Extract<RoutineSchedule, { kind: 'interval' }>): number => schedule.everyMinutes * 60_000

/** The next `n` runs strictly after `after`, within startsAt and endsAt. */
export function nextRuns(t: Timing, after: Date, n: number): Date[] {
  const start = new Date(t.startsAt)
  const end = t.endsAt ? new Date(t.endsAt).getTime() : Infinity
  let runs: Date[]
  if (t.schedule.kind === 'once') runs = start > after ? [start] : []
  else if (t.schedule.kind === 'interval') {
    const every = intervalMs(t.schedule)
    const first = after < start ? 0 : Math.floor((after.getTime() - start.getTime()) / every) + 1
    runs = Array.from({ length: n }, (_, i) => new Date(start.getTime() + (first + i) * every))
  } else {
    // A second before the start, so a run at exactly the start counts (croner works in whole seconds).
    runs = cronOf(t.schedule, t)
      .nextRuns(n + 1, after < start ? new Date(start.getTime() - 1000) : after)
      .filter((d) => d >= start && d > after)
  }
  return runs.filter((d) => d.getTime() <= end).slice(0, n)
}

/** The latest run at or before `now` (within startsAt and endsAt), if any. */
export function latestRun(t: Timing, now: Date): Date | undefined {
  const start = new Date(t.startsAt)
  const end = t.endsAt ? new Date(t.endsAt) : undefined
  const until = end && end < now ? end : now
  if (until < start) return undefined
  if (t.schedule.kind === 'once') return start
  if (t.schedule.kind === 'interval') {
    const every = intervalMs(t.schedule)
    return new Date(start.getTime() + Math.floor((until.getTime() - start.getTime()) / every) * every)
  }
  // previousRuns looks strictly before its reference, in whole seconds; a second later includes a run at
  // exactly `until` (runs fall on whole minutes), and the filter drops one that second let in.
  const [last] = cronOf(t.schedule, t).previousRuns(1, new Date(until.getTime() + 1000))
  return last && last >= start && last <= until ? last : undefined
}
