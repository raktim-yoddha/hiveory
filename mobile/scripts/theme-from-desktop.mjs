// The phone's colors come from the desktop's tokens.css (design.md): one source of
// truth for all six themes. `pnpm sync:theme` writes src/core/theme/palettes.ts, and a
// test fails when the desktop changed and the phone was not re-synced.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOKENS_CSS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'renderer', 'src', 'styles', 'tokens.css')

/** Desktop token → phone palette key. */
const KEYS = {
  'color-bg': 'bg',
  'base-surface': 'surface',
  'base-surface-top': 'surfaceTop',
  'base-surface-raised': 'surfaceRaised',
  'base-surface-hover': 'surfaceHover',
  'base-surface-active': 'surfaceActive',
  'base-surface-inset': 'surfaceInset',
  'color-overlay': 'overlay',
  'color-border': 'border',
  'color-border-strong': 'borderStrong',
  'color-text': 'text',
  'color-text-secondary': 'textSecondary',
  'color-text-muted': 'textMuted',
  'color-text-faint': 'textFaint',
  'color-accent': 'accent',
  'color-accent-contrast': 'accentContrast',
  'color-bronze': 'brand',
  'color-bronze-soft': 'brandSoft',
  'color-focus': 'focus',
  'color-logo-tile': 'logoTile',
  'color-idle': 'idle',
  'color-working': 'working',
  'color-waiting': 'waiting',
  'color-success': 'success',
  'color-warning': 'warning',
  'color-danger': 'danger',
  'color-working-soft': 'workingSoft',
  'color-waiting-soft': 'waitingSoft',
  'color-waiting-edge': 'waitingEdge',
  'color-danger-soft': 'dangerSoft'
}
const TERM = ['bg', 'fg', 'cursor', 'selection', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const termKey = (name) => name.replace(/^term-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())

/** `rgb(1 2 3 / 0.5)` → `rgba(1, 2, 3, 0.5)`: React Native reads every form, older versions only this one. */
const color = (value) => {
  const m = /^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)$/.exec(value)
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${m[4]})` : value
}

/** Every theme's palette: the root block (Bronze) with each theme's overrides on top. */
export const palettesFromCss = (css) => {
  const blocks = {}
  for (const m of css.matchAll(/:root(?:\[data-theme='([a-z]+)'\])?\s*\{([^}]*)\}/g)) {
    const vars = {}
    for (const v of m[2].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[v[1]] = v[2].trim()
    blocks[m[1] ?? 'bronze'] = { ...(blocks[m[1] ?? 'bronze'] ?? {}), ...vars }
  }
  const root = blocks.bronze
  const out = {}
  for (const name of ['dark', 'bronze', 'silver', 'midnight', 'jade', 'rose']) {
    const vars = { ...root, ...(blocks[name] ?? {}) }
    const palette = {}
    for (const [token, key] of Object.entries(KEYS)) {
      if (vars[token] === undefined) throw new Error(`tokens.css has no --${token} for ${name}`)
      palette[key] = color(vars[token])
    }
    palette.terminal = {}
    for (const token of Object.keys(vars).filter((t) => t.startsWith('term-'))) {
      const key = termKey(token)
      if (TERM.includes(key) || key.startsWith('bright')) palette.terminal[key] = color(vars[token])
    }
    out[name] = palette
  }
  return out
}

export const desktopPalettes = () => palettesFromCss(readFileSync(TOKENS_CSS, 'utf8'))
