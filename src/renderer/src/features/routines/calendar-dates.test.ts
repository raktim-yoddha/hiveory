import { describe, expect, it } from 'vitest'
import type { RoutineView } from '@shared/domain/routine'
import { busyDays, dayKey, weekStartOf } from './calendar-dates'

const routine = (over: Partial<RoutineView>): RoutineView =>
  ({ id: 'r', name: 'R', prompt: 'x', timezone: 'UTC', enabled: true, results: 'none', checkedThrough: '', createdAt: '', updatedAt: '', ...over }) as RoutineView

describe('calendar dates', () => {
  it('starts weeks on Monday', () => {
    expect(weekStartOf(new Date(2026, 9, 8)).getDate()).toBe(5)
    expect(weekStartOf(new Date(2026, 9, 11)).getDate()).toBe(5)
    expect(weekStartOf(new Date(2026, 9, 12)).getDate()).toBe(12)
  })

  it('marks the days ahead with a run of an enabled routine', () => {
    const from = new Date(Date.now() + 24 * 3_600_000)
    const at = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12)
    const once = routine({ schedule: { kind: 'once' }, startsAt: at.toISOString() })
    const paused = routine({ id: 'p', enabled: false, schedule: { kind: 'once' }, startsAt: new Date(at.getTime() + 24 * 3_600_000).toISOString() })
    const days = busyDays([once, paused], new Date(), new Date(Date.now() + 10 * 24 * 3_600_000))
    expect([...days]).toEqual([dayKey(at)])
  })
})
