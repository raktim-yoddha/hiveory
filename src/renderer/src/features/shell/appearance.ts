import type { AppSettings, ThemeId } from '@shared/domain'
import { refreshTerminalTheme } from '../terminal/terminal-registry'

export const wallpaperUrl = (file: string): string => `hv-wallpaper://img/${file}`

/** The CSS background for a wallpaper setting, or null for none. */
export const wallpaperBackground = (wallpaper: string): string | null => {
  if (wallpaper.startsWith('image:')) return `url("${wallpaperUrl(wallpaper.slice(6))}") center / cover no-repeat`
  return null
}

type Look = Pick<AppSettings, 'theme' | 'wallpaper' | 'surfaceOpacity' | 'wallpaperBlur' | 'wallpaperDim'>

/** Puts the theme and wallpaper on <html>: tokens.css reads `data-theme`, `data-wallpaper` and the variables. */
export const applyLook = (look: Look): void => {
  const root = document.documentElement
  root.dataset.theme = look.theme
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
export const crossFadeTheme = (theme: ThemeId): void => {
  const swap = (): void => {
    document.documentElement.dataset.theme = theme
    refreshTerminalTheme()
  }
  if (typeof document.startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(swap)
  } else swap()
}
