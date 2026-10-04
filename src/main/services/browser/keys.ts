/** A CDP `Input.dispatchKeyEvent` description of one key. */
export interface KeyDefinition {
  key: string
  code: string
  keyCode: number
  text?: string
}

export interface KeyChord {
  modifiers: number
  keys: KeyDefinition[]
}

/** CDP modifier bits. */
const MODIFIERS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }
const MODIFIER_ALIASES: Record<string, string> = {
  alt: 'Alt',
  option: 'Alt',
  ctrl: 'Control',
  control: 'Control',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  super: 'Meta',
  shift: 'Shift'
}

const NAMED: Record<string, Omit<KeyDefinition, 'key'>> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  Insert: { code: 'Insert', keyCode: 45 },
  Alt: { code: 'AltLeft', keyCode: 18 },
  Control: { code: 'ControlLeft', keyCode: 17 },
  Meta: { code: 'MetaLeft', keyCode: 91 },
  Shift: { code: 'ShiftLeft', keyCode: 16 }
}
for (let i = 1; i <= 12; i++) NAMED[`F${i}`] = { code: `F${i}`, keyCode: 111 + i }

const ALIASES: Record<string, string> = {
  return: 'Enter',
  esc: 'Escape',
  del: 'Delete',
  ' ': 'Space',
  space: 'Space',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  pgup: 'PageUp',
  pgdn: 'PageDown'
}

const PUNCTUATION: Record<string, [string, number]> = {
  ';': ['Semicolon', 186], '=': ['Equal', 187], ',': ['Comma', 188], '-': ['Minus', 189], '.': ['Period', 190],
  '/': ['Slash', 191], '`': ['Backquote', 192], '[': ['BracketLeft', 219], '\\': ['Backslash', 220],
  ']': ['BracketRight', 221], "'": ['Quote', 222]
}

const keyOf = (name: string): KeyDefinition => {
  const canonical = ALIASES[name.toLowerCase()] ?? Object.keys(NAMED).find((k) => k.toLowerCase() === name.toLowerCase())
  if (canonical) {
    const def = NAMED[canonical]!
    return { key: canonical === 'Space' ? ' ' : canonical, ...def }
  }
  if ([...name].length !== 1) throw new Error(`Unknown key "${name}". Use names like Enter, Tab, Escape, ArrowDown, F5, or single characters.`)
  const upper = name.toUpperCase()
  if (/[A-Z]/.test(upper)) return { key: name, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: name }
  if (/[0-9]/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name }
  const [code, keyCode] = PUNCTUATION[name] ?? ['', 0]
  return { key: name, code, keyCode, text: name }
}

/**
 * Parses "Enter", "Control+A", "Shift+Tab" or a space-separated sequence
 * ("ArrowDown ArrowDown Enter") into chords. A lone "+" is the plus key.
 */
export const parseKeys = (input: string): KeyChord[] => {
  const chords = input.trim().split(/\s+/).filter(Boolean)
  if (!chords.length) throw new Error('No keys given.')
  return chords.map((chord) => {
    const parts = chord === '+' ? ['+'] : chord.split('+').map((p, i, all) => (p === '' && i === all.length - 1 ? '+' : p)).filter(Boolean)
    let modifiers = 0
    const keys: KeyDefinition[] = []
    parts.forEach((part, index) => {
      const modifier = MODIFIER_ALIASES[part.toLowerCase()]
      if (modifier && index < parts.length - 1) modifiers |= MODIFIERS[modifier]!
      else keys.push(keyOf(part))
    })
    if (!keys.length) throw new Error(`"${chord}" has modifiers but no key.`)
    if (modifiers & MODIFIERS.Shift!) {
      for (const k of keys) if (k.text && /^[a-z]$/.test(k.text)) Object.assign(k, { key: k.text.toUpperCase(), text: k.text.toUpperCase() })
    }
    return { modifiers, keys }
  })
}
