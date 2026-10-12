/** Keys a phone keyboard lacks, as the bytes a terminal expects. */
export const KEYS = {
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  slash: '/',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  interrupt: '\x03'
} as const

export interface Modifiers {
  ctrl: boolean
  alt: boolean
}

/**
 * One key as a terminal reads it with Ctrl and/or Alt held (xterm conventions): Ctrl+letter is
 * its control code, Alt prefixes Esc, and a held arrow becomes `ESC [1;<mod><dir>`.
 */
export const withModifiers = (bytes: string, { ctrl, alt }: Modifiers): string => {
  if (!ctrl && !alt) return bytes
  const arrow = /^\x1b\[([ABCD])$/.exec(bytes)
  if (arrow) return `\x1b[1;${1 + (alt ? 2 : 0) + (ctrl ? 4 : 0)}${arrow[1]}`
  let out = bytes
  if (ctrl && out.length === 1) {
    const code = out.toUpperCase().charCodeAt(0)
    if (code >= 64 && code <= 95) out = String.fromCharCode(code - 64)
    else if (out === ' ') out = '\x00'
    else if (out === '?') out = '\x7f'
  }
  return alt ? `\x1b${out}` : out
}
