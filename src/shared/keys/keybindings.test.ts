import { describe, expect, it } from 'vitest'
import { parseShortcut, shortcutProblem } from './shortcut'
import { APP_COMMANDS, bindingClash, bindingOf, cleanKeybindings, commandFor, defaultBinding } from './keybindings'

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

  it('never takes a key terminal CLIs use on Windows and Linux (Ctrl + a letter)', () => {
    for (const c of APP_COMMANDS) {
      const problem = shortcutProblem(parseShortcut(c.other)!, 'linux')
      expect(problem, c.id).toBeNull()
    }
    expect(commandFor(key('KeyB', { ctrlKey: true }), {}, 'win32')).toBeNull()
    expect(commandFor(key('KeyB', { ctrlKey: true, shiftKey: true }), {}, 'win32')).toBe('toggle-sidebar')
  })

  it('gives every command its own keys on every platform, none of them reserved there', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const keys = APP_COMMANDS.map((c) => defaultBinding(c.id, platform))
      expect(new Set(keys).size, platform).toBe(keys.length)
      for (const c of APP_COMMANDS) {
        expect(shortcutProblem(parseShortcut(defaultBinding(c.id, platform))!, platform), `${platform} ${c.id}`).toBeNull()
      }
    }
    expect(commandFor(key('Tab', { ctrlKey: true }), {}, 'win32')).toBe('next-tab')
    expect(commandFor(key('Tab', { ctrlKey: true, shiftKey: true }), {}, 'win32')).toBe('previous-tab')
    expect(commandFor(key('KeyT', { metaKey: true }), {}, 'darwin')).toBe('new-tab')
  })

  it('matches exactly: an extra modifier is a different shortcut', () => {
    expect(commandFor(key('Comma', { ctrlKey: true }), {}, 'linux')).toBe('open-settings')
    expect(commandFor(key('Comma', { ctrlKey: true, altKey: true }), {}, 'linux')).toBeNull()
  })

  it('follows the user: a changed shortcut, a cleared one, and junk dropped on load', () => {
    // Shortcuts of removed commands (Bots and Chat, ADR 0056) are junk too.
    const mine = cleanKeybindings({ 'toggle-sidebar': 'Control+Alt+KeyS', 'open-schedules': '', 'no-such': 'Control+KeyQ', 'mode-bots': 'Control+Digit2', 'next-tab': 'nonsense' })
    expect(mine).toEqual({ 'toggle-sidebar': 'Control+Alt+KeyS', 'open-schedules': '' })
    expect(commandFor(key('KeyS', { ctrlKey: true, altKey: true }), mine, 'win32')).toBe('toggle-sidebar')
    expect(commandFor(key('KeyB', { ctrlKey: true, shiftKey: true }), mine, 'win32')).toBeNull()
    expect(bindingOf('open-schedules', mine, 'win32')).toBeNull()
    expect(bindingOf('next-tab', mine, 'win32')).toEqual(parseShortcut('Control+Tab'))
  })

  it('names who already uses some keys', () => {
    expect(bindingClash('Control+Comma', 'toggle-sidebar', {}, 'win32')).toBe('Open or close Settings')
    expect(bindingClash('Control+Comma', 'open-settings', {}, 'win32')).toBeNull()
    expect(bindingClash('Control+Shift+Space', 'toggle-sidebar', {}, 'win32')).toBeNull()
  })
})
