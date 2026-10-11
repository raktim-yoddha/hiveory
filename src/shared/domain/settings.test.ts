import { describe, expect, it } from 'vitest'
import { DEFAULT_TERMINAL_FONT, safeTerminalFont, UPDATE_INTERVAL_MS, updateOverdue } from './settings'

describe('update reminders (ADR 0039)', () => {
  it('counts an update overdue two days after its release, never without a date', () => {
    const released = '2026-10-01T00:00:00Z'
    expect(updateOverdue(released, Date.parse('2026-10-02T23:00:00Z'))).toBe(false)
    expect(updateOverdue(released, Date.parse('2026-10-03T00:00:00Z'))).toBe(true)
    expect(updateOverdue(undefined)).toBe(false)
    expect(UPDATE_INTERVAL_MS.daily).toBe(24 * UPDATE_INTERVAL_MS.hourly)
  })
})

describe('terminal font (ADR 0039)', () => {
  it('survives any stored or requested value', () => {
    expect(safeTerminalFont(undefined)).toEqual(DEFAULT_TERMINAL_FONT)
    expect(safeTerminalFont({ family: 'x"; } body {', size: 999, lineHeight: -4, weight: 'bold', italic: 'no' })).toEqual({ ...DEFAULT_TERMINAL_FONT, size: 32, lineHeight: 1 })
    expect(safeTerminalFont({ ...DEFAULT_TERMINAL_FONT, family: 'Fira Code', size: 17.6, lineHeight: 1.111 })).toMatchObject({ family: 'Fira Code', size: 18, lineHeight: 1.11 })
  })
})
