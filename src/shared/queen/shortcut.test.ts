import { describe, expect, it } from 'vitest'
import { formatShortcut, parseShortcut, shortcutLabel, shortcutProblem, ShortcutTracker } from './shortcut'

describe('Queen Bee shortcut', () => {
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

  it('tells a tap from a hold, and ignores combinations that grew another key', () => {
    const t = new ShortcutTracker(parseShortcut('Meta+Alt')!, 350)
    expect(t.keyDown('MetaLeft', 0)).toBeNull()
    expect(t.keyDown('AltLeft', 10)).toBe('press')
    expect(t.keyUp('AltLeft', 120)).toBe('tap')
    t.keyUp('MetaLeft', 130)

    t.keyDown('MetaLeft', 1000)
    t.keyDown('AltLeft', 1000)
    expect(t.tick(1200)).toBeNull()
    expect(t.tick(1400)).toBe('hold-start')
    expect(t.keyUp('MetaLeft', 3000)).toBe('hold-end')
    t.keyUp('AltLeft', 3001)

    // Win+Alt+R is someone else's shortcut: no tap.
    t.keyDown('MetaLeft', 5000)
    t.keyDown('AltLeft', 5000)
    t.keyDown('KeyR', 5050)
    expect(t.keyUp('KeyR', 5100)).toBeNull()

    const k = new ShortcutTracker(parseShortcut('Control+Shift+Space')!)
    k.keyDown('ControlLeft', 0)
    k.keyDown('ShiftLeft', 0)
    expect(k.keyDown('Space', 5)).toBe('press')
    expect(k.keyUp('Space', 60)).toBe('tap')
  })
})
