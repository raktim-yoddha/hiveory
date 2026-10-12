import { describe, expect, it } from 'vitest'
import { defaultQueenShortcut, parseShortcut, queenShortcutOf, shortcutProblem } from '../queen/shortcut'
import { APP_COMMANDS, bindingClash, bindingOf, cleanKeybindings, commandFor } from './keybindings'

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('keybindings', () => {
  it('uses ⌘ on macOS and Ctrl (never the Windows/Super key) on Windows and Linux', () => {
    for (const c of APP_COMMANDS) {
      expect(c.mac.startsWith('Meta+'), c.id).toBe(true)
      expect(c.other.includes('Meta'), c.id).toBe(false)
      expect(parseShortcut(c.mac)?.code, c.id).toBeTruthy()
      expect(parseShortcut(c.other)?.code, c.id).toBeTruthy()
    }
    expect(commandFor(key('Comma', { metaKey: true }), {}, 'darwin')).toBe('open-settings')
    expect(commandFor(key('Comma', { ctrlKey: true }), {}, 'win32')).toBe('open-settings')
    expect(commandFor(key('Comma', { ctrlKey: true }), {}, 'darwin')).toBeNull()
  })

  it('never takes a key terminal CLIs use on Windows and Linux (Ctrl + a letter), except "New" outside Work', () => {
    for (const c of APP_COMMANDS) {
      const problem = shortcutProblem(parseShortcut(c.other)!, 'linux', { terminals: c.id !== 'new-item' })
      expect(problem, c.id).toBeNull()
    }
    expect(commandFor(key('KeyB', { ctrlKey: true }), {}, 'win32')).toBeNull()
    expect(commandFor(key('KeyB', { ctrlKey: true, shiftKey: true }), {}, 'win32')).toBe('toggle-sidebar')
  })

  it('matches exactly: an extra modifier is a different shortcut', () => {
    expect(commandFor(key('Digit1', { ctrlKey: true }), {}, 'linux')).toBe('mode-work')
    expect(commandFor(key('Digit1', { ctrlKey: true, altKey: true }), {}, 'linux')).toBeNull()
  })

  it('follows the user: a changed shortcut, a cleared one, and junk dropped on load', () => {
    const mine = cleanKeybindings({ 'toggle-sidebar': 'Control+Alt+KeyS', 'mode-chat': '', 'no-such': 'Control+KeyQ', 'mode-bots': 'nonsense' })
    expect(mine).toEqual({ 'toggle-sidebar': 'Control+Alt+KeyS', 'mode-chat': '' })
    expect(commandFor(key('KeyS', { ctrlKey: true, altKey: true }), mine, 'win32')).toBe('toggle-sidebar')
    expect(commandFor(key('KeyB', { ctrlKey: true, shiftKey: true }), mine, 'win32')).toBeNull()
    expect(bindingOf('mode-chat', mine, 'win32')).toBeNull()
    expect(bindingOf('mode-bots', mine, 'win32')).toEqual(parseShortcut('Control+Digit2'))
  })

  it('names who already uses some keys', () => {
    const queen = queenShortcutOf('', 'win32')
    expect(bindingClash('Control+Comma', 'toggle-sidebar', {}, queen, 'win32')).toBe('Open or close Settings')
    expect(bindingClash('Control+Shift+Space', 'toggle-sidebar', {}, queen, 'win32')).toBe('Queen Bee')
    expect(bindingClash('Control+Comma', 'open-settings', {}, queen, 'win32')).toBeNull()
    expect(bindingClash('Control+Shift+Space', 'queen', {}, queen, 'win32')).toBeNull()
  })
})

describe("Queen Bee's standard keys", () => {
  it('are ⌥ Space on macOS and Ctrl Shift Space elsewhere, and none of them is reserved', () => {
    expect(defaultQueenShortcut('darwin')).toBe('Alt+Space')
    expect(defaultQueenShortcut('win32')).toBe('Control+Shift+Space')
    expect(defaultQueenShortcut('linux')).toBe('Control+Shift+Space')
    for (const p of ['darwin', 'win32', 'linux']) expect(shortcutProblem(parseShortcut(defaultQueenShortcut(p))!, p)).toBeNull()
  })

  it("an empty or broken stored shortcut means the platform's standard", () => {
    expect(queenShortcutOf('', 'darwin')).toEqual(parseShortcut('Alt+Space'))
    expect(queenShortcutOf('garbage', 'win32')).toEqual(parseShortcut('Control+Shift+Space'))
    expect(queenShortcutOf('Control+Meta', 'win32')).toEqual(parseShortcut('Control+Meta'))
  })
})
