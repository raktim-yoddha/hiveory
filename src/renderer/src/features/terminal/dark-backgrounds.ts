/**
 * Some TUIs (Kilo, Grok…) paint their whole screen with an explicit near-black background
 * instead of the terminal's default, which shows up as a black slab over the pane and its
 * wallpaper. Rewrites such SGR backgrounds (24-bit or 256-color) to the default background
 * (`49`); lighter fills — input boxes, selections, highlights — are kept.
 */

/** A background this dark is the CLI's own "screen", not a highlight. */
const DARK_MAX_CHANNEL = 24

const isDark = (r: number, g: number, b: number): boolean => Math.max(r, g, b) <= DARK_MAX_CHANNEL

/** RGB of a 256-color index from the 6×6×6 cube or the gray ramp; undefined for the 16 theme colors. */
const xterm256 = (n: number): [number, number, number] | undefined => {
  if (n >= 232 && n <= 255) {
    const v = 8 + (n - 232) * 10
    return [v, v, v]
  }
  if (n < 16 || n > 231) return undefined
  const level = (i: number): number => (i === 0 ? 0 : 55 + i * 40)
  const c = n - 16
  return [level(Math.floor(c / 36)), level(Math.floor(c / 6) % 6), level(c % 6)]
}

const darkColor = (mode: string | undefined, values: string[]): boolean => {
  const n = values.map(Number)
  if (mode === '2' && n.length >= 3) return isDark(n[0]!, n[1]!, n[2]!)
  if (mode === '5' && n.length >= 1) {
    const rgb = xterm256(n[0]!)
    return Boolean(rgb && isDark(...rgb))
  }
  return false
}

/** Rewrites one SGR parameter string (between `ESC [` and `m`). */
const rewriteSgr = (params: string): string => {
  const parts = params.split(';')
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    // Colon form: 48:2::r:g:b or 48:2:r:g:b or 48:5:n, all in one parameter.
    if (part.startsWith('48:')) {
      const [, mode, ...rest] = part.split(':')
      const values = (mode === '2' && rest.length === 4 ? rest.slice(1) : rest).filter((v) => v !== '')
      out.push(darkColor(mode, values) ? '49' : part)
      continue
    }
    if (part === '48') {
      const mode = parts[i + 1]
      const count = mode === '2' ? 3 : mode === '5' ? 1 : 0
      const values = parts.slice(i + 2, i + 2 + count)
      if (count && values.length === count) {
        out.push(darkColor(mode, values) ? '49' : parts.slice(i, i + 2 + count).join(';'))
        i += 1 + count
        continue
      }
    }
    out.push(part)
  }
  return out.join(';')
}

// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[([0-9;:]*)m/g
/** An escape sequence cut off at the end of a chunk; held until the next one completes it. */
// eslint-disable-next-line no-control-regex
const PARTIAL = /\x1b(?:\[[0-9;:]*)?$/

/** Stateful per terminal: chunks may split a sequence. */
export const createDarkBackgroundFilter = (): ((chunk: string) => string) => {
  let carry = ''
  return (chunk) => {
    let data = carry + chunk
    carry = ''
    const partial = PARTIAL.exec(data)
    if (partial) {
      carry = partial[0]
      data = data.slice(0, partial.index)
    }
    return data.includes('48') ? data.replace(SGR, (whole, params: string) => (params.includes('48') ? `\x1b[${rewriteSgr(params)}m` : whole)) : data
  }
}
