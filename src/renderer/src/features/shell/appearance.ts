import { THEME_COLOR, type AppSettings, type VsCodeTheme } from '@shared/domain'
import { refreshTerminalTheme } from '../terminal/terminal-registry'

export const wallpaperUrl = (file: string): string => `hv-wallpaper://img/${file}`

/** The CSS background for a wallpaper setting, or null for none. */
export const wallpaperBackground = (wallpaper: string): string | null => {
  if (wallpaper.startsWith('image:')) return `url("${wallpaperUrl(wallpaper.slice(6))}") center / cover no-repeat`
  return null
}

type Look = Pick<AppSettings, 'theme' | 'wallpaper' | 'surfaceOpacity' | 'wallpaperBlur' | 'wallpaperDim'>

const STYLE_ID = 'hv-vscode-theme'
const TOKEN_NAME = /^[a-z0-9-]{1,40}$/

/**
 * A VS Code theme (ADR 0034) as one stylesheet over the built-in theme's tokens. Only
 * token names and hex colors are written, so a theme file can never inject CSS.
 */
const applyCustomTheme = (custom: VsCodeTheme | null): void => {
  const root = document.documentElement
  document.getElementById(STYLE_ID)?.remove()
  if (!custom) {
    delete root.dataset.customTheme
    return
  }
  const vars = Object.entries(custom.tokens)
    .filter(([name, value]) => TOKEN_NAME.test(name) && THEME_COLOR.test(value))
    .map(([name, value]) => `--${name}: ${value};`)
    .join('')
  const style = document.createElement('style')
  style.id = STYLE_ID
  // [data-theme][data-custom-theme] outranks each built-in `:root[data-theme='…']` block.
  style.textContent = `:root[data-theme][data-custom-theme] { color-scheme: ${custom.kind === 'light' ? 'light' : 'dark'}; ${vars} }`
  document.head.append(style)
  root.dataset.customTheme = custom.kind
}

/**
 * Puts the theme and wallpaper on <html>: tokens.css reads `data-theme`, `data-wallpaper` and
 * the variables. `custom` is the applied VS Code theme, layered over the built-in one.
 */
export const applyLook = (look: Look, custom: VsCodeTheme | null = null): void => {
  const root = document.documentElement
  root.dataset.theme = look.theme
  applyCustomTheme(custom)
  const background = wallpaperBackground(look.wallpaper)
  if (background) {
    root.dataset.wallpaper = ''
    root.style.setProperty('--wallpaper-image', background)
    setLookVariable('surfaceOpacity', look.surfaceOpacity)
    setLookVariable('wallpaperBlur', look.wallpaperBlur)
    setLookVariable('wallpaperDim', look.wallpaperDim)
  } else {
    delete root.dataset.wallpaper
    for (const name of ['--wallpaper-image', '--surface-alpha', '--wallpaper-blur', '--wallpaper-dim']) root.style.removeProperty(name)
  }
  refreshTerminalTheme()
}

/** Live preview while a slider moves; the setting is saved when it is released. */
export const setLookVariable = (key: 'surfaceOpacity' | 'wallpaperBlur' | 'wallpaperDim', value: number): void => {
  const style = document.documentElement.style
  if (key === 'surfaceOpacity') style.setProperty('--surface-alpha', String(value))
  if (key === 'wallpaperBlur') style.setProperty('--wallpaper-blur', `${value}px`)
  if (key === 'wallpaperDim') style.setProperty('--wallpaper-dim', String(value))
}

/** Switches theme with a cross-fade of the whole window (one snapshot, composited — no per-element transitions). */
export const crossFadeLook = (look: Look, custom: VsCodeTheme | null): void => {
  const swap = (): void => applyLook(look, custom)
  if (typeof document.startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(swap)
  } else swap()
}
