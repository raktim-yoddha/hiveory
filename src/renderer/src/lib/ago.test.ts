import { describe, expect, it } from 'vitest'
import { until } from './ago'

describe('until', () => {
  const now = Date.parse('2026-10-26T12:00:00Z')
  const at = (minutes: number): string => new Date(now + minutes * 60_000).toISOString()
  it('says how long until a reset, shortest unit first', () => {
    expect(until(at(45), now)).toBe('in 45 min')
    expect(until(at(133), now)).toBe('in 2 h 13 min')
    expect(until(at(120), now)).toBe('in 2 h')
    expect(until(at(3 * 1440 + 4 * 60), now)).toBe('in 3 d 4 h')
    expect(until(at(-5), now)).toBe('now')
    expect(until('not a date', now)).toBe('')
  })
})
