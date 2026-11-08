import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { fitWindow, MIN_SIZE, readWindowState, writeWindowState } from './window-state'
import appIcon from '@resources/icon.png?asset'
import devIcon from '@resources/icon-dev.png?asset'
import type { Logger } from './logger'

import type { ThemeId } from '@shared/domain'

/** Native title-bar overlay colors per theme (they cannot read CSS variables). */
export const THEME_CHROME: Record<ThemeId, { background: string; symbols: string }> = {
  dark: { background: '#000000', symbols: '#a3a3a3' },
  bronze: { background: '#080706', symbols: '#b8afa3' },
  silver: { background: '#08090b', symbols: '#b6bac2' }
}
export type WindowChrome = { background: string; symbols: string }
/** No title bar (ADR 0056): the window controls sit on the top-right card, never on a solid strip. */
const OVERLAY_COLOR = '#00000000'
export const WINDOW_BACKGROUND = THEME_CHROME.bronze.background
/** The window controls' height, centred on the top bars (page top + top bar + page top), as --window-controls-height. */
export const TITLE_BAR_HEIGHT = 46

export interface WindowTargets {
  preload: string
  rendererFile: string
  devServerUrl?: string
}

/** Creates the hardened main window (Electron security checklist). */
/** `custom`: an applied VS Code theme's chrome (ADR 0034), which wins over the built-in theme's. */
export const createMainWindow = (targets: WindowTargets, log: Logger, theme: ThemeId = 'dark', custom?: WindowChrome | null): BrowserWindow => {
  const isMac = process.platform === 'darwin'
  const chrome = custom ?? THEME_CHROME[theme]
  // The window opens where it was, at its size, when that is still on a screen (ADR 0061).
  const stateFile = join(app.getPath('userData'), 'window-state.json')
  const saved = fitWindow(readWindowState(stateFile), screen.getAllDisplays().map((d) => d.workArea))
  const window = new BrowserWindow({
    ...(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: 1440, height: 900 }),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: 'Hiveory',
    // Taskbar/window icon on Windows and Linux; macOS uses the bundle icon. Dev builds carry a DEV mark.
    icon: app.isPackaged ? appIcon : devIcon,
    backgroundColor: chrome.background,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 20, y: 17 } }
      : { titleBarOverlay: { color: OVERLAY_COLOR, symbolColor: chrome.symbols, height: TITLE_BAR_HEIGHT } }),
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

  // A frameless window's constructor size gains Windows' invisible borders; setBounds() means what
  // getBounds() reports, so the window comes back at exactly the size it was saved with.
  if (saved) window.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })
  window.once('ready-to-show', () => {
    if (saved?.maximized) window.maximize()
    window.show()
    setTimeout(() => (settled = true), 1500)
  })
  // Remembered once a move or resize settles (normal bounds for a maximized window). While the window
  // closes, Windows resizes it by its invisible borders: nothing from then on is kept, or the window
  // would grow a little on every launch.
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let closing = false
  // The system's own adjustments while the window appears (scaling, borders) are not the user's: ignored.
  let settled = false
  const remember = (): void => {
    if (closing || window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return
    const maximized = window.isMaximized()
    writeWindowState(stateFile, { ...(maximized ? window.getNormalBounds() : window.getBounds()), maximized })
  }
  const rememberSoon = (): void => {
    if (closing || !settled) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      remember()
    }, 600)
  }
  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) window.on(event as 'resize', rememberSoon)
  window.on('close', () => {
    // A save still waiting is made now, with the bounds the window had before it started closing.
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer)
      saveTimer = undefined
      remember()
    }
    closing = true
  })
  // A close kept in the tray (Background mode) is not the end: the window comes back and is remembered again.
  for (const event of ['show', 'restore'] as const) window.on(event as 'show', () => (closing = false))

  // No in-app navigation or popups; http(s) links open in the system browser.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // No camera, microphone or other device permission is ever granted (ADR 0057).
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  // The window never navigates away from Hiveory's page (will-navigate is blocked), so its contents identify it.
  // local-fonts: Settings › Terminal font lists installed monospaced families (names only; ADR 0039).
  window.webContents.session.setPermissionCheckHandler((wc, permission) => (permission as string) === 'local-fonts' && wc === window.webContents)

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
export const applyWindowTheme = (window: BrowserWindow, theme: ThemeId, custom?: WindowChrome | null): void => {
  const chrome = custom ?? THEME_CHROME[theme]
  window.setBackgroundColor(chrome.background)
  if (process.platform !== 'darwin') {
    try {
      window.setTitleBarOverlay({ color: OVERLAY_COLOR, symbolColor: chrome.symbols, height: TITLE_BAR_HEIGHT })
    } catch {
      // Overlay unavailable on this platform/window.
    }
  }
}
