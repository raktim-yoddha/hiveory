import { app, BrowserWindow, Menu } from 'electron'
import electronUpdater from 'electron-updater'
import { join } from 'node:path'
import { IPC_PREFIX } from '@shared/ipc/contract'
import { createContainer, type Container } from './app/container'
import { createLogger } from './app/logger'
import { resolvePaths } from './app/paths'
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

const targets = rendererTargets(import.meta.dirname)
let window: BrowserWindow | null = null
let container: Container | null = null

const emit: Emit = (event, payload) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(IPC_PREFIX + event, payload)
  }
}

const openWindow = (): void => {
  window = createMainWindow(targets, log, container?.settings.get().theme)
  window.on('closed', () => (window = null))
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
  container = createContainer(paths, log, emit, app.isPackaged ? electronUpdater.autoUpdater : null)
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
    if (next.theme !== previous.theme) for (const w of BrowserWindow.getAllWindows()) applyWindowTheme(w, next.theme)
    if (next.autoCheckUpdates !== previous.autoCheckUpdates) container?.updates.setAutoCheck(next.autoCheckUpdates)
  })
  container.updates.setAutoCheck(container.settings.get().autoCheckUpdates)
  registerIpc(
    createHandlers(container),
    (event) => isTrustedSenderUrl(event.senderFrame?.url, targets.devServerUrl, targets.rendererFile),
    log
  )
  openWindow()
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
  container.runtime.disposeAll()
  container.shells.disposeAll()
  container.chats.stopAll()
  container.hookServer.stop()
  container.store.flush()
})
