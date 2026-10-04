import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import appIcon from '@resources/icon.png?asset'
import type { Logger } from './logger'

export const WINDOW_BACKGROUND = '#080706'
export const TITLE_BAR_HEIGHT = 44

export interface WindowTargets {
  preload: string
  rendererFile: string
  devServerUrl?: string
}

/** Creates the hardened main window (Electron security checklist). */
export const createMainWindow = (targets: WindowTargets, log: Logger): BrowserWindow => {
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Hiveory',
    // Taskbar/window icon on Windows and Linux; macOS uses the bundle icon.
    icon: appIcon,
    backgroundColor: WINDOW_BACKGROUND,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarOverlay: { color: WINDOW_BACKGROUND, symbolColor: '#b8afa3', height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: targets.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // No in-app navigation or popups; http(s) links open in the system browser.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

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
