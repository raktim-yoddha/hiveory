/**
 * A keyboard shortcut (ADR 0047): two or three keys, either modifiers only ("Control+Meta") or
 * modifiers plus one key ("Control+Shift+KeyK"). Stored as modifiers in a fixed order, then the
 * key's `KeyboardEvent.code`, so it works on any keyboard layout.
 */

export type Modifier = 'Control' | 'Alt' | 'Shift' | 'Meta'
export const MODIFIERS: Modifier[] = ['Control', 'Alt', 'Shift', 'Meta']

export interface Shortcut {
  mods: Modifier[]
  /** KeyboardEvent.code of the non-modifier key, if any. */
  code?: string
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/
const KEY_CODE = /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Backquote|Backslash|BracketLeft|BracketRight|Comma|Period|Slash|Semicolon|Quote|Minus|Equal|Enter|Tab|Arrow(Up|Down|Left|Right)|Numpad[0-9])$/

export const isModifierCode = (code: string): boolean => MODIFIER_CODES.test(code)

export function parseShortcut(text: string): Shortcut | null {
  const parts = text.split('+').filter(Boolean)
  const mods = MODIFIERS.filter((m) => parts.includes(m))
  const rest = parts.filter((p) => !MODIFIERS.includes(p as Modifier))
  if (rest.length > 1 || (rest[0] && !KEY_CODE.test(rest[0]))) return null
  const total = mods.length + rest.length
  // Any order; no repeats, nothing unknown.
  if (total !== parts.length || total < 2 || total > 3 || !mods.length) return null
  return { mods, ...(rest[0] ? { code: rest[0] } : {}) }
}

export const formatShortcut = (s: Shortcut): string => [...MODIFIERS.filter((m) => s.mods.includes(m)), ...(s.code ? [s.code] : [])].join('+')

/**
 * Why a shortcut can't be used, or null when it can. Guards the keys terminals
 * and the OS rely on: Ctrl+letter is a terminal control code, Ctrl+Alt is AltGr
 * on many keyboards, Alt+Shift and Ctrl+Shift switch keyboard layouts on Windows.
 */
export function shortcutProblem(s: Shortcut, platform: string, { terminals = true }: { terminals?: boolean } = {}): string | null {
  const only = (...mods: Modifier[]) => s.mods.length === mods.length && mods.every((m) => s.mods.includes(m))
  // `terminals: false`: a shortcut that never fires where a terminal is (ADR 0047).
  if (terminals && s.code && only('Control') && /^Key[A-Z]$/.test(s.code)) return 'Terminals use Ctrl + a letter. Add another modifier.'
  if (s.code && only('Shift')) return 'Shift + a key types a character. Use Ctrl, Alt or the Windows/⌘ key.'
  if (platform !== 'darwin' && !s.code && (only('Control', 'Alt') || only('Alt', 'Shift') || only('Control', 'Shift'))) {
    return 'Windows uses this for AltGr or keyboard layouts. Pick another.'
  }
  if (platform !== 'darwin' && s.code === 'Delete' && only('Control', 'Alt')) return 'Reserved by Windows.'
  if (platform === 'darwin' && s.code && only('Meta') && /^Key[QWHMN]$|^Tab$|^Space$/.test(s.code)) return 'Reserved by macOS.'
  if (platform !== 'darwin' && s.code && only('Alt') && /^(Tab|Space|F4)$/.test(s.code)) return 'Reserved by Windows.'
  return null
}

const KEY_LABEL: Record<string, string> = { Space: 'Space', Backquote: '`', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=' }

/** "Win + Alt" on Windows, "⌘⌥" on macOS. */
export function shortcutLabel(s: Shortcut, platform: string): string {
  const key = s.code ? (KEY_LABEL[s.code] ?? s.code.replace(/^(Key|Digit|Numpad|Arrow)/, '')) : null
  if (platform === 'darwin') {
    const sym: Record<Modifier, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    // macOS order: ⌃ ⌥ ⇧ ⌘.
    return MODIFIERS.filter((m) => s.mods.includes(m)).map((m) => sym[m]).join('') + (key ?? '')
  }
  const word: Record<Modifier, string> = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: platform === 'win32' ? 'Win' : 'Super' }
  // Windows reads Win first.
  const order: Modifier[] = ['Meta', 'Control', 'Alt', 'Shift']
  return [...order.filter((m) => s.mods.includes(m)).map((m) => word[m]), ...(key ? [key] : [])].join(' + ')
}

/** Set while Settings records a new shortcut, so pressing keys there triggers nothing. */
export const shortcutRecording = { active: false }
