import { describe, expect, it, vi } from 'vitest'
import { defaultBinding } from '@shared/keys/keybindings'
import { hex6, mixHex, onTerminalFindRequest, requestTerminalFind, searchDecorations } from './terminal-search'

describe('find in a terminal (ADR 0072)', () => {
  it('reads theme colors as #rrggbb, as the search addon needs', () => {
    expect(hex6('#E8B04F')).toBe('#e8b04f')
    expect(hex6('#abc')).toBe('#aabbcc')
    expect(hex6('#11223344')).toBe('#112233')
    expect(hex6('rgb(217 203 180 / 0.24)')).toBe('#d9cbb4')
    expect(hex6('rgba(0, 0, 0, 0)')).toBe('#000000')
    expect(hex6('var(--x)')).toBeUndefined()
  })

  it('tints matches from the background toward yellow, the current one more', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    const tokens: Record<string, string> = { bg: '#101010', yellow: '#e8b04f', 'bright-yellow': '#f3cd85' }
    const d = searchDecorations((name) => tokens[name] ?? '')
    expect(d).toMatchObject({ matchOverviewRuler: '#e8b04f', activeMatchColorOverviewRuler: '#f3cd85' })
    expect(d.matchBackground).toMatch(/^#[0-9a-f]{6}$/)
    expect(d.activeMatchBackground).not.toBe(d.matchBackground)
    // An unreadable theme (a VS Code theme without these colors) still gives valid colors.
    expect(Object.values(searchDecorations(() => '')).every((c) => /^#[0-9a-f]{6}$/.test(c as string))).toBe(true)
  })

  it('opens the find bar of a terminal that shows one, and only while it does', () => {
    const open = vi.fn()
    const stop = onTerminalFindRequest('t1', open)
    expect(requestTerminalFind('t1')).toBe(true)
    expect(requestTerminalFind('t2')).toBe(false)
    stop()
    expect(requestTerminalFind('t1')).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('leaves Ctrl+F to the shell outside macOS', () => {
    expect(defaultBinding('find-in-terminal', 'win32')).toBe('Control+Shift+KeyF')
    expect(defaultBinding('find-in-terminal', 'darwin')).toBe('Meta+KeyF')
  })
})
