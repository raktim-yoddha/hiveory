import type { ISearchOptions } from '@xterm/addon-search'

/** Find in a terminal's scrollback (ADR 0072): who opens a find bar, and the colors of its matches. */

type Decorations = NonNullable<ISearchOptions['decorations']>

/** Each mounted terminal's "open your find bar" (the shortcut, Find › Find in the terminal). */
const findRequests = new Map<string, () => void>()

/** Opens (or focuses) the find bar of a terminal; false when it shows none. */
export const requestTerminalFind = (instanceId: string): boolean => {
  const open = findRequests.get(instanceId)
  open?.()
  return Boolean(open)
}

/** A terminal view takes its find requests; the returned function stops that. */
export const onTerminalFindRequest = (instanceId: string, open: () => void): (() => void) => {
  findRequests.set(instanceId, open)
  return () => {
    if (findRequests.get(instanceId) === open) findRequests.delete(instanceId)
  }
}

/** A CSS color (#rgb, #rrggbb, #rrggbbaa, rgb()/rgba()) as #rrggbb, which the search addon needs; undefined if unreadable. */
export function hex6(css: string): string | undefined {
  const text = css.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(text)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(text)
  if (long) return `#${long[1]}`
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text)
  if (!rgb) return undefined
  return `#${rgb.slice(1, 4).map((n) => Math.min(255, Math.round(Number(n))).toString(16).padStart(2, '0')).join('')}`
}

/** `a` moved toward `b` by `amount` (0–1), both #rrggbb. */
export function mixHex(a: string, b: string, amount: number): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * amount).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Match colors from the terminal theme, in its silver (ADR 0018 amendment 2026-11-13): matches are the
 * background tinted toward its white so their text stays readable, the current match more strongly;
 * the scrollbar marks them in the same silver.
 */
export function searchDecorations(token: (name: string) => string): Decorations {
  const background = hex6(token('bg')) ?? '#000000'
  const silver = hex6(token('white')) ?? '#d0d0d0'
  const bright = hex6(token('bright-white')) ?? silver
  return {
    matchBackground: mixHex(background, silver, 0.22),
    activeMatchBackground: mixHex(background, bright, 0.45),
    matchOverviewRuler: mixHex(background, silver, 0.6),
    activeMatchColorOverviewRuler: bright
  }
}
