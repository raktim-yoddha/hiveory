import { readFileSync, writeFileSync } from 'node:fs'

/** Where and how big the window was (ADR 0061), so it opens there again. */
export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_SIZE = { width: 960, height: 600 }

const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/**
 * The saved bounds when they still make sense on the screens attached now: at least half the window on
 * one display's work area, never smaller than the minimum or bigger than that display. Else undefined,
 * and the window opens at its default size, centred.
 */
export const fitWindow = (saved: unknown, workAreas: Rect[]): WindowState | undefined => {
  if (!saved || typeof saved !== 'object') return undefined
  const s = saved as Record<string, unknown>
  const nums = ['x', 'y', 'width', 'height'].map((k) => s[k])
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
  const [x, y, w, h] = nums as number[]
  const best = workAreas
    .map((area) => ({ area, shared: overlap({ x: x!, y: y!, width: w!, height: h! }, area) }))
    .sort((a, b) => b.shared - a.shared)[0]
  // Half of the window on that screen (or half the screen covered, for a window bigger than it).
  if (!best || best.shared < Math.min(w! * h!, best.area.width * best.area.height) / 2) return undefined
  const width = Math.round(Math.min(Math.max(w!, MIN_SIZE.width), best.area.width))
  const height = Math.round(Math.min(Math.max(h!, MIN_SIZE.height), best.area.height))
  return { x: Math.round(x!), y: Math.round(y!), width, height, maximized: s.maximized === true }
}

export const readWindowState = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

export const writeWindowState = (file: string, state: WindowState): void => {
  try {
    writeFileSync(file, JSON.stringify(state))
  } catch {
    // Not remembering where the window was is never worth an error.
  }
}
