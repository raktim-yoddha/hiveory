import { describe, expect, it } from 'vitest'
import type { RoutineSchedule } from './routine'
import { compileRepeat, cronProblem, latestRun, nextRuns, validTimezone, wallClock } from './routine-schedule'

const NY = 'America/New_York'
const IN = 'Asia/Kolkata'
// Wednesday 7 October 2026, 23:00 in India.
const wed11pmIndia = new Date('2026-10-07T17:30:00.000Z')
const timing = (schedule: RoutineSchedule, startsAt: string, timezone = NY, endsAt?: string) => ({ schedule, startsAt, timezone, ...(endsAt ? { endsAt } : {}) })
const iso = (dates: Date[]) => dates.map((d) => d.toISOString())

describe('routine schedules', () => {
  it('reads wall-clock time in the routine timezone', () => {
    expect(wallClock(wed11pmIndia, IN)).toEqual({ minute: 0, hour: 23, day: 7, month: 10, weekday: 3 })
  })

  it('compiles each repeat preset to cron at the start time', () => {
    expect(compileRepeat('daily', wed11pmIndia, IN)).toBe('0 23 * * *')
    expect(compileRepeat('weekdays', wed11pmIndia, IN)).toBe('0 23 * * 1-5')
    expect(compileRepeat('weekly', wed11pmIndia, IN)).toBe('0 23 * * 3')
    expect(compileRepeat('selected-days', wed11pmIndia, IN, [5, 1, 3, 1])).toBe('0 23 * * 1,3,5')
    expect(compileRepeat('selected-days', wed11pmIndia, IN, [])).toBe('0 23 * * 3')
    expect(compileRepeat('monthly', wed11pmIndia, IN)).toBe('0 23 7 * *')
    expect(compileRepeat('month-end', wed11pmIndia, IN)).toBe('0 23 L * *')
    expect(compileRepeat('yearly', wed11pmIndia, IN)).toBe('0 23 7 10 *')
  })

  it('accepts five-field cron with L and #, and refuses seconds, macros and nonsense', () => {
    expect(cronProblem('0 9 L * *')).toBeNull()
    expect(cronProblem('0 9 * * MON#2')).toBeNull()
    expect(cronProblem('*/15 9-16 * * MON-FRI')).toBeNull()
    expect(cronProblem('0 0 9 * * *')).toMatch(/five fields/)
    expect(cronProblem('@daily')).toMatch(/shortcut/)
    expect(cronProblem('61 9 * * *')).not.toBeNull()
    expect(validTimezone(IN)).toBe(true)
    expect(validTimezone('Mars/Base')).toBe(false)
  })

  it('keeps 09:00 local across the end of daylight saving', () => {
    // US clocks go back on Sunday 1 November 2026: 09:00 is 13:00 UTC before and 14:00 UTC after.
    const t = timing({ kind: 'cron', expr: '0 9 * * *', preset: 'daily' }, '2026-10-30T00:00:00.000Z')
    expect(iso(nextRuns(t, new Date('2026-10-30T00:00:00.000Z'), 4))).toEqual([
      '2026-10-30T13:00:00.000Z',
      '2026-10-31T13:00:00.000Z',
      '2026-11-01T14:00:00.000Z',
      '2026-11-02T14:00:00.000Z'
    ])
  })

  it('runs a time that falls in the spring-forward gap once, later that morning', () => {
    // 02:30 does not exist in New York on 8 March 2026.
    const t = timing({ kind: 'cron', expr: '30 2 * * *', preset: 'daily' }, '2026-03-07T00:00:00.000Z')
    const runs = nextRuns(t, new Date('2026-03-07T00:00:00.000Z'), 3)
    expect(runs).toHaveLength(3)
    expect(runs.filter((d) => d.toISOString().startsWith('2026-03-08'))).toHaveLength(1)
  })

  it('never runs before the start, and stops at the end', () => {
    const t = timing({ kind: 'cron', expr: '0 9 * * *', preset: 'daily' }, '2026-10-10T00:00:00.000Z', NY, '2026-10-11T23:00:00.000Z')
    expect(iso(nextRuns(t, new Date('2026-10-01T00:00:00.000Z'), 5))).toEqual(['2026-10-10T13:00:00.000Z', '2026-10-11T13:00:00.000Z'])
  })

  it('counts intervals from the start', () => {
    const t = timing({ kind: 'interval', everyMinutes: 90 }, '2026-10-07T10:00:00.000Z')
    expect(iso(nextRuns(t, new Date('2026-10-07T10:00:00.000Z'), 2))).toEqual(['2026-10-07T11:30:00.000Z', '2026-10-07T13:00:00.000Z'])
    expect(iso(nextRuns(t, new Date('2026-10-07T09:00:00.000Z'), 1))).toEqual(['2026-10-07T10:00:00.000Z'])
    expect(latestRun(t, new Date('2026-10-07T12:59:00.000Z'))?.toISOString()).toBe('2026-10-07T11:30:00.000Z')
  })

  it('runs once at the start time', () => {
    const t = timing({ kind: 'once' }, '2026-10-07T17:30:00.000Z')
    expect(iso(nextRuns(t, new Date('2026-10-07T17:00:00.000Z'), 3))).toEqual(['2026-10-07T17:30:00.000Z'])
    expect(nextRuns(t, new Date('2026-10-07T17:30:00.000Z'), 3)).toEqual([])
    expect(latestRun(t, new Date('2026-10-07T17:00:00.000Z'))).toBeUndefined()
    expect(latestRun(t, new Date('2026-10-07T18:00:00.000Z'))?.toISOString()).toBe('2026-10-07T17:30:00.000Z')
  })

  it('finds the latest cron run, including one exactly now', () => {
    const t = timing({ kind: 'cron', expr: '0 9 * * *', preset: 'daily' }, '2026-10-01T00:00:00.000Z')
    expect(latestRun(t, new Date('2026-10-07T13:00:00.000Z'))?.toISOString()).toBe('2026-10-07T13:00:00.000Z')
    expect(latestRun(t, new Date('2026-10-07T12:59:00.000Z'))?.toISOString()).toBe('2026-10-06T13:00:00.000Z')
    expect(latestRun(t, new Date('2026-09-30T00:00:00.000Z'))).toBeUndefined()
  })
})

describe('the first run', () => {
  it('counts a run at exactly the start, the time the user picked', () => {
    // Thursday 8 October 2026, 09:00 in India, on a weekdays-at-09:00 rule.
    const t = timing({ kind: 'cron', expr: '0 9 * * 1-5', preset: 'weekdays' }, '2026-10-08T03:30:00.000Z', IN)
    expect(iso(nextRuns(t, new Date('2026-10-07T00:00:00.000Z'), 2))).toEqual(['2026-10-08T03:30:00.000Z', '2026-10-09T03:30:00.000Z'])
    expect(latestRun(t, new Date('2026-10-08T03:30:00.000Z'))?.toISOString()).toBe('2026-10-08T03:30:00.000Z')
  })
})
