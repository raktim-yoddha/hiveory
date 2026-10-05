/**
 * Queen Bee's shortcut (ADR 0019): two or three keys, either modifiers only
 * ("Meta+Alt": Win+Alt on Windows, ⌘⌥ on macOS) or modifiers plus one key
 * ("Control+Shift+Space"). Stored as modifiers in a fixed order, then the key's
 * `KeyboardEvent.code`, so it works on any keyboard layout.
 */

export type Modifier = 'Control' | 'Alt' | 'Shift' | 'Meta'
export const MODIFIERS: Modifier[] = ['Control', 'Alt', 'Shift', 'Meta']
export const DEFAULT_SHORTCUT = 'Meta+Alt'

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
export function shortcutProblem(s: Shortcut, platform: string): string | null {
  const only = (...mods: Modifier[]) => s.mods.length === mods.length && mods.every((m) => s.mods.includes(m))
  if (s.code && only('Control') && /^Key[A-Z]$/.test(s.code)) return 'Terminals use Ctrl + a letter. Add another modifier.'
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

/** Ready-made choices per platform. */
export const SHORTCUT_PRESETS = (platform: string): string[] =>
  platform === 'darwin' ? ['Meta+Alt', 'Control+Meta', 'Control+Shift+Space'] : ['Meta+Alt', 'Control+Meta', 'Control+Shift+Space']

/**
 * Tracks one shortcut through key events: a tap (pressed and released quickly with
 * nothing else pressed) and a hold (kept down past `holdMs`). Pure: the caller feeds
 * events and a clock, and gets back what happened.
 */
export class ShortcutTracker {
  private down = new Set<string>()
  private since: number | null = null
  private spoiled = false
  private holding = false

  constructor(
    private readonly shortcut: Shortcut,
    private readonly holdMs = 350
  ) {}

  private matches(): boolean {
    const mods = new Set<Modifier>()
    let other = 0
    for (const code of this.down) {
      const m = /^(Control|Alt|Shift|Meta|OS)/.exec(code)?.[1]
      if (m) mods.add(m === 'OS' ? 'Meta' : (m as Modifier))
      else if (code !== this.shortcut.code) other++
    }
    return (
      other === 0 &&
      mods.size === this.shortcut.mods.length &&
      this.shortcut.mods.every((m) => mods.has(m)) &&
      (!this.shortcut.code || this.down.has(this.shortcut.code))
    )
  }

  /** Returns 'press' when the full combination just came down. */
  keyDown(code: string, now: number): 'press' | null {
    if (this.down.has(code)) return null
    this.down.add(code)
    if (this.since !== null && !this.matches()) this.spoiled = true
    if (this.since === null && this.matches()) {
      this.since = now
      this.spoiled = false
      this.holding = false
      return 'press'
    }
    return null
  }

  /** Called on a timer while pressed: 'hold-start' once the hold threshold passes. */
  tick(now: number): 'hold-start' | null {
    if (this.since === null || this.spoiled || this.holding || now - this.since < this.holdMs) return null
    this.holding = true
    return 'hold-start'
  }

  /** 'tap' or 'hold-end' when the combination is let go; null when it never counted. */
  keyUp(code: string, now: number): 'tap' | 'hold-end' | null {
    this.down.delete(code)
    if (this.since === null) return null
    const started = this.since
    this.since = null
    if (this.holding) {
      this.holding = false
      return 'hold-end'
    }
    return !this.spoiled && now - started < this.holdMs ? 'tap' : null
  }

  /** The window lost focus: forget everything (keyup events won't arrive). */
  reset(): 'hold-end' | null {
    const wasHolding = this.holding
    this.down.clear()
    this.since = null
    this.holding = false
    return wasHolding ? 'hold-end' : null
  }
}

/** The system-wide shortcut (opt-in): whether the native keyboard hook runs. */
export type HotkeyStatus =
  | { state: 'off' }
  | { state: 'on' }
  /** macOS: Hiveory needs Accessibility access to see keys in other apps. */
  | { state: 'needs-permission' }
  | { state: 'unsupported'; reason: string }
  | { state: 'error'; error: string }

/** What the system-wide shortcut did while another app was focused. */
export type HotkeySignal = 'tap' | 'hold-start' | 'hold-end'
