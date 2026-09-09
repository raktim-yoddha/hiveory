import { describe, expect, it } from 'vitest'
import { getTerminalShortcutAction } from './terminal-shortcuts'

function shortcut(key: string, options: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...options,
  }
}

describe('getTerminalShortcutAction', () => {
  it('maps terminal editing shortcuts to exactly one terminal action', () => {
    expect(getTerminalShortcutAction(shortcut('a', { ctrlKey: true }))).toEqual({ kind: 'select-all' })
    expect(getTerminalShortcutAction(shortcut('v', { ctrlKey: true }))).toEqual({ kind: 'paste' })
    expect(getTerminalShortcutAction(shortcut('z', { ctrlKey: true }))).toEqual({ kind: 'send-control', data: '\u001a' })
    expect(getTerminalShortcutAction(shortcut('y', { ctrlKey: true }))).toEqual({ kind: 'send-control', data: '\u0019' })
    expect(getTerminalShortcutAction(shortcut('c', { ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'copy-selection' })
  })

  it('does not take unrelated browser or terminal shortcuts', () => {
    expect(getTerminalShortcutAction(shortcut('k', { ctrlKey: true }))).toBeNull()
    expect(getTerminalShortcutAction(shortcut('v'))).toBeNull()
    expect(getTerminalShortcutAction(shortcut('v', { ctrlKey: true, shiftKey: true }))).toBeNull()
  })
})
