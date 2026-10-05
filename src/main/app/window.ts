import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import appIcon from '@resources/icon.png?asset'
import devIcon from '@resources/icon-dev.png?asset'
import { isTrustedSenderUrl } from '../ipc/trust'
import type { Logger } from './logger'

import type { ThemeId } from '@shared/domain'

/** Native title-bar overlay colors per theme (they cannot read CSS variables). */
export const THEME_CHROME: Record<ThemeId, { background: string; symbols: string }> = {
  dark: { background: '#000000', symbols: '#a3a3a3' },
  bronze: { background: '#080706', symbols: '#b8afa3' },
  silver: { background: '#08090b', symbols: '#b6bac2' },
  midnight: { background: '#05070c', symbols: '#a9b3c5' },
  jade: { background: '#040706', symbols: '#a6b7ae' },
  rose: { background: '#080608', symbols: '#bcadb3' }
}
/** Over a wallpaper the window controls sit on the picture, not on a solid strip. */
const overlayColor = (theme: ThemeId, wallpaper: boolean): string => (wallpaper ? '#00000000' : THEME_CHROME[theme].background)
export const WINDOW_BACKGROUND = THEME_CHROME.bronze.background
export const TITLE_BAR_HEIGHT = 44

export interface WindowTargets {
  preload: string
  rendererFile: string
  devServerUrl?: string
}

/** Creates the hardened main window (Electron security checklist). */
export const createMainWindow = (targets: WindowTargets, log: Logger, theme: ThemeId = 'dark', wallpaper = false): BrowserWindow => {
  const isMac = process.platform === 'darwin'
  const chrome = THEME_CHROME[theme]
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Hiveory',
    // Taskbar/window icon on Windows and Linux; macOS uses the bundle icon. Dev builds carry a DEV mark.
    icon: app.isPackaged ? appIcon : devIcon,
    backgroundColor: chrome.background,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarOverlay: { color: overlayColor(theme, wallpaper), symbolColor: chrome.symbols, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: targets.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // Work and Chat keep streaming while the window is hidden or in the background.
      backgroundThrottling: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // No in-app navigation or popups; http(s) links open in the system browser.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Only the microphone, only audio, only for the app's own page: Queen Bee's push-to-talk.
  const ownPage = (url: string): boolean => isTrustedSenderUrl(url, targets.devServerUrl, targets.rendererFile)
  window.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
    const audioOnly = permission === 'media' && 'mediaTypes' in details && (details.mediaTypes ?? []).length > 0 && (details.mediaTypes ?? []).every((t) => t === 'audio')
    callback(audioOnly && wc === window.webContents && ownPage(details.requestingUrl))
  })
  // The window never navigates away from Hiveory's page (will-navigate is blocked), so its contents identify it.
  window.webContents.session.setPermissionCheckHandler((wc, permission) => permission === 'media' && wc === window.webContents)

  // DevTools stay reachable in development without an application menu.
  if (targets.devServerUrl) {
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
        window.webContents.toggleDevTools()
      }
    })
  }

  // A crashed renderer reloads instead of leaving a dead window; agents keep running in main.
  let lastCrash = 0
  window.webContents.on('render-process-gone', (_event, details) => {
    log.error(`Renderer gone: ${details.reason}`)
    if (details.reason === 'clean-exit') return
    const now = Date.now()
    if (now - lastCrash > 5000) setTimeout(() => !window.isDestroyed() && window.reload(), 300)
    lastCrash = now
  })

  if (targets.devServerUrl) void window.loadURL(targets.devServerUrl)
  else void window.loadFile(targets.rendererFile)
  return window
}

export const rendererTargets = (baseDir: string): WindowTargets => ({
  preload: join(baseDir, '../preload/index.cjs'),
  rendererFile: join(baseDir, '../renderer/index.html'),
  devServerUrl: process.env.ELECTRON_RENDERER_URL
})

/** Repaints native chrome to match the theme. */
export const applyWindowTheme = (window: BrowserWindow, theme: ThemeId, wallpaper = false): void => {
  const chrome = THEME_CHROME[theme]
  window.setBackgroundColor(chrome.background)
  if (process.platform !== 'darwin') {
    try {
      window.setTitleBarOverlay({ color: overlayColor(theme, wallpaper), symbolColor: chrome.symbols, height: TITLE_BAR_HEIGHT })
    } catch {
      // Overlay unavailable on this platform/window.
    }
  }
}
