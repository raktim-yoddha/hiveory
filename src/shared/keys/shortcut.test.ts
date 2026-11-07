import { describe, expect, it } from 'vitest'
import { formatShortcut, parseShortcut, shortcutLabel, shortcutProblem } from './shortcut'

describe('shortcuts', () => {
  it('accepts two or three keys with at least one modifier, in canonical order', () => {
    expect(parseShortcut('Meta+Alt')).toEqual({ mods: ['Alt', 'Meta'] })
    expect(parseShortcut('Alt+Meta')).toEqual({ mods: ['Alt', 'Meta'] })
    expect(parseShortcut('Control+Shift+Space')).toEqual({ mods: ['Control', 'Shift'], code: 'Space' })
    expect(parseShortcut('Meta')).toBeNull()
    expect(parseShortcut('Control+Alt+Shift+KeyK')).toBeNull()
    expect(parseShortcut('KeyA+KeyB')).toBeNull()
    expect(parseShortcut('Control+rm -rf')).toBeNull()
    expect(formatShortcut({ mods: ['Meta', 'Control'], code: 'KeyQ' })).toBe('Control+Meta+KeyQ')
  })

  it('refuses keys terminals and the OS rely on', () => {
    expect(shortcutProblem(parseShortcut('Control+KeyC')!, 'win32')).toMatch(/Terminals/)
    expect(shortcutProblem(parseShortcut('Control+Alt')!, 'win32')).toMatch(/AltGr/)
    expect(shortcutProblem(parseShortcut('Alt+Shift')!, 'win32')).toMatch(/keyboard layouts/)
    expect(shortcutProblem(parseShortcut('Meta+KeyQ')!, 'darwin')).toMatch(/macOS/)
    expect(shortcutProblem(parseShortcut('Meta+Alt')!, 'win32')).toBeNull()
    expect(shortcutProblem(parseShortcut('Meta+Alt')!, 'darwin')).toBeNull()
  })

  it('reads naturally on each OS', () => {
    expect(shortcutLabel(parseShortcut('Meta+Alt')!, 'win32')).toBe('Win + Alt')
    expect(shortcutLabel(parseShortcut('Meta+Alt')!, 'darwin')).toBe('⌥⌘')
    expect(shortcutLabel(parseShortcut('Control+Shift+Space')!, 'darwin')).toBe('⌃⇧Space')
    expect(shortcutLabel(parseShortcut('Control+Shift+Space')!, 'linux')).toBe('Ctrl + Shift + Space')
  })
})
