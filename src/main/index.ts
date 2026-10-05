import { app, BrowserWindow, Menu, net, protocol } from 'electron'
import electronUpdater from 'electron-updater'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WALLPAPER_SCHEME } from './services/appearance/wallpaper-service'
import { IPC_PREFIX } from '@shared/ipc/contract'
import { createContainer, type Container } from './app/container'
import { createLogger } from './app/logger'
import { resolvePaths } from './app/paths'
import { adoptLoginShellPath } from './app/shell-path'
import { applyWindowTheme, createMainWindow, rendererTargets } from './app/window'
import { createHandlers } from './ipc/handlers'
import { registerIpc } from './ipc/router'
import { isTrustedSenderUrl } from './ipc/trust'
import type { Emit } from './services/events'

// Dev builds keep their own data so experiments never touch real projects' state.
const appName = app.isPackaged ? 'Hiveory' : 'Hiveory Dev'
app.setName(appName)
// HIVEORY_USER_DATA lets automated smoke runs use a throwaway profile.
app.setPath('userData', process.env.HIVEORY_USER_DATA ?? join(app.getPath('appData'), appName))

const paths = resolvePaths(app.getPath('userData'), appName)
const log = createLogger(paths.logDir)

// A bug in one service must never take the whole app down.
process.on('uncaughtException', (error) => log.error('Uncaught exception', error))
process.on('unhandledRejection', (reason) => log.error('Unhandled rejection', reason))

if (!app.requestSingleInstanceLock()) app.quit()

// Wallpapers load through Hiveory's own scheme, limited to its wallpapers folder (never arbitrary files).
protocol.registerSchemesAsPrivileged([{ scheme: WALLPAPER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])

// Defense in depth for every web contents (window, browser pages, DevTools): no <webview>, and no
// popups unless the creator installs its own handler (the window and browser pages do).
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

const targets = rendererTargets(import.meta.dirname)
let window: BrowserWindow | null = null
let container: Container | null = null

const emit: Emit = (event, payload) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(IPC_PREFIX + event, payload)
  }
}

const openWindow = (): void => {
  const s = container?.settings.get()
  window = createMainWindow(targets, log, s?.theme, Boolean(s?.wallpaper))
  window.on('closed', () => (window = null))
  container?.browser.setWindow(window)
}

app.on('second-instance', () => {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.whenReady().then(async () => {
  // No application menu on Windows/Linux: its hidden Alt accelerators would swallow
  // Alt-shortcuts (Alt+V, Alt+C…) that CLIs rely on. Copy/paste are handled by the terminal.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  // Finder-launched apps get a minimal PATH: adopt the login shell's before any CLI is looked up.
  await adoptLoginShellPath(log)
  container = createContainer(paths, log, emit, app.isPackaged ? electronUpdater.autoUpdater : null)
  const wallpapers = container.wallpapers
  protocol.handle(WALLPAPER_SCHEME, (request) => {
    const file = wallpapers.resolve(request.url)
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 })
  })
  const notice = container.store.load()
  container.workspaceRepo.adoptImplicitMainWorkspaces()
  container.chatStore.load()
  try {
    await container.hookServer.start()
  } catch (error) {
    // Status detection degrades to PTY heuristics (ADR 0006).
    log.error('Hook server failed to start', error)
  }
  container.runtime.on('data', (instanceId, data, offset) => emit('terminal.data', { instanceId, data, offset }))
  container.shells.on('data', (instanceId, data, offset) => emit('terminal.data', { instanceId, data, offset }))
  container.settings.on('changed', (next, previous) => {
    if (next.theme !== previous.theme || Boolean(next.wallpaper) !== Boolean(previous.wallpaper)) {
      for (const w of BrowserWindow.getAllWindows()) applyWindowTheme(w, next.theme, Boolean(next.wallpaper))
    }
    if (next.autoCheckUpdates !== previous.autoCheckUpdates) container?.updates.setAutoCheck(next.autoCheckUpdates)
    if (next.computerUse && !previous.computerUse) container?.computer.warm()
    if (!next.computerUse && previous.computerUse) container?.computer.dispose()
    if (next.queenGlobalShortcut !== previous.queenGlobalShortcut || next.queenShortcut !== previous.queenShortcut) {
      container?.hotkey.apply(next.queenGlobalShortcut, next.queenShortcut)
    }
  })
  container.updates.setAutoCheck(container.settings.get().autoCheckUpdates)
  if (container.settings.get().computerUse) container.computer.warm()
  const startup = container.settings.get()
  if (startup.queenGlobalShortcut) container.hotkey.apply(true, startup.queenShortcut)
  registerIpc(
    createHandlers(container),
    (event) => isTrustedSenderUrl(event.senderFrame?.url, targets.devServerUrl, targets.rendererFile),
    log
  )
  openWindow()
  // Durable sessions: every agent comes back on its own, resuming its conversation.
  container.agents.resumeAll()
  if (notice) {
    window?.webContents.once('did-finish-load', () => emit('app.notice', { level: 'warning', message: notice }))
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (!container) return
  container.browser.closeAll()
  container.computer.dispose()
  container.hotkey.stop()
  void container.gateway.closeAll()
  container.files.closeAll()
  container.runtime.disposeAll()
  container.shells.disposeAll()
  container.chats.stopAll()
  container.hookServer.stop()
  container.store.flush()
})
