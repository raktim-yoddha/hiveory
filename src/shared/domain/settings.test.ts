import { describe, expect, it } from 'vitest'
import { UPDATE_INTERVAL_MS, updateOverdue } from './settings'

describe('update reminders (ADR 0039)', () => {
  it('counts an update overdue two days after its release, never without a date', () => {
    const released = '2026-10-01T00:00:00Z'
    expect(updateOverdue(released, Date.parse('2026-10-02T23:00:00Z'))).toBe(false)
    expect(updateOverdue(released, Date.parse('2026-10-03T00:00:00Z'))).toBe(true)
    expect(updateOverdue(undefined)).toBe(false)
    expect(UPDATE_INTERVAL_MS.daily).toBe(24 * UPDATE_INTERVAL_MS.hourly)
  })
})
