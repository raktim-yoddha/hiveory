import type { RoutineView } from '@shared/domain/routine'
import { nextRuns } from '@shared/domain/routine-schedule'

export const DAY_MS = 24 * 60 * 60 * 1000

/** Monday 00:00 of the week holding `day`, in this computer's time. */
export const weekStartOf = (day: Date): Date => {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

export const startOfDay = (day: Date): Date => new Date(day.getFullYear(), day.getMonth(), day.getDate())

export const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Local-date keys ("2026-9-8") of the days in [from, to) that have an upcoming run of an enabled routine. */
export function busyDays(routines: RoutineView[], from: Date, to: Date, limitPerRoutine = 400): Set<string> {
  const days = new Set<string>()
  const start = new Date(Math.max(from.getTime(), Date.now()))
  for (const r of routines) {
    if (!r.enabled) continue
    for (const at of nextRuns(r, start, limitPerRoutine)) {
      if (at >= to) break
      days.add(dayKey(at))
    }
  }
  return days
}

export const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
