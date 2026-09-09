export type TerminalShortcutAction =
  | { kind: 'copy-selection' }
  | { kind: 'paste' }
  | { kind: 'select-all' }
  | { kind: 'send-control'; data: string }

type TerminalShortcutEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'>

/**
 * Maps the editing shortcuts Hiveory owns to one terminal operation. Keeping
 * this separate from xterm makes browser-level paste events and terminal key
 * events mutually exclusive.
 */
export function getTerminalShortcutAction(event: TerminalShortcutEvent): TerminalShortcutAction | null {
  if (!(event.ctrlKey || event.metaKey)) return null

  const key = event.key.toLowerCase()
  if (event.shiftKey) return key === 'c' ? { kind: 'copy-selection' } : null

  switch (key) {
    case 'a':
      return { kind: 'select-all' }
    case 'v':
      return { kind: 'paste' }
    case 'z':
      return { kind: 'send-control', data: '\u001a' }
    case 'y':
      return { kind: 'send-control', data: '\u0019' }
    default:
      return null
  }
}
