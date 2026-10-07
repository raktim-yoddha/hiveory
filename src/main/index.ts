import { app, BrowserWindow, Menu, net, powerMonitor, protocol, safeStorage } from 'electron'
import electronUpdater from 'electron-updater'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WALLPAPER_SCHEME } from './services/appearance/wallpaper-service'
import { IPC_PREFIX } from '@shared/ipc/contract'
import { DEFAULT_SERVER_PORT } from '@shared/ipc/remote'
import type { QueenUpdate } from '@shared/queen/updates'
import { readClientConfig } from './app/client'
import { runClientMode } from './app/client-mode'
import { createContainer, type Container } from './app/container'
import { guard } from './app/guard'
import { createLogger } from './app/logger'
import { resolvePaths } from './app/paths'
import { adoptLoginShellPath } from './app/shell-path'
import { BackgroundTray } from './app/tray'
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

/** `--serve <port>` (or `--serve=<port>`): run as a Hiveory server without a window (ADR 0022); `--tailscale` also serves the tailnet (ADR 0025). */
const argValue = (flag: string): string | undefined => {
  const at = process.argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`))
  if (at < 0) return undefined
  const arg = process.argv[at]!
  return arg.includes('=') ? arg.slice(flag.length + 1) : process.argv[at + 1]
}
const servePort = argValue('--serve')
/** Loopback by default: clients come through an SSH tunnel. Another address (e.g. Tailscale) is explicit. */
const serveHost = argValue('--serve-host') ?? '127.0.0.1'
const serveTailnet = process.argv.includes('--tailscale')
let stopClient: (() => void) | null = null

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
/** Set once a real quit starts (tray, Cmd+Q, an update): closing the window then really closes it. */
let quitting = false
const tray = new BackgroundTray(
  () => window,
  () => (container ? container.store.state.instances.filter((i) => container!.agents.details(i).running).length : 0),
  () => app.quit()
)

// A window that is closing, or a payload that cannot be sent, never breaks the service that emitted.
const emit: Emit = (event, payload) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || w.webContents.isDestroyed()) continue
    try {
      w.webContents.send(IPC_PREFIX + event, payload)
    } catch (error) {
      log.warn(`Could not send ${event}`, error)
    }
  }
  // Clients of this machine's server get every event too.
  guard(log, 'Server events', () => container?.sharing.broadcast(event, payload))
  // Paired phones hear when an agent needs the user, even with the app closed (ADR 0027).
  if (event === 'queen.update') guard(log, 'Push', () => container?.sharing.notifyWaiting(payload as QueenUpdate))
}

const openWindow = (): void => {
  const s = container?.settings.get()
  window = createMainWindow(targets, log, s?.theme, Boolean(s?.wallpaper))
  window.on('closed', () => (window = null))
  // Closing keeps the agents running: the window hides into the tray (unless that setting is off).
  window.on('close', (event) => {
    if (quitting || !container?.settings.get().keepRunningInBackground) return
    event.preventDefault()
    tray.hide()
  })
  container?.browser.setWindow(window)
}

app.on('second-instance', () => tray.show())

app.whenReady().then(async () => {
  // No application menu on Windows/Linux: its hidden Alt accelerators would swallow
  // Alt-shortcuts (Alt+V, Alt+C…) that CLIs rely on. Copy/paste are handled by the terminal.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  // Finder-launched apps get a minimal PATH: adopt the login shell's before any CLI is looked up.
  await adoptLoginShellPath(log)
  // A desktop paired with a Hiveory server runs no services of its own: it is that server's window.
  const clientConfig = servePort === undefined ? readClientConfig(paths.clientFile, safeStorage) : null
  if (clientConfig) {
    stopClient = await runClientMode(clientConfig, paths, log, targets)
    return
  }
  container = createContainer(paths, log, emit, app.isPackaged ? electronUpdater.autoUpdater : null)
  const wallpapers = container.wallpapers
  guard(log, 'Wallpaper protocol', () =>
    protocol.handle(WALLPAPER_SCHEME, (request) => {
      const file = wallpapers.resolve(request.url)
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 })
    })
  )
  const c = container
  // Each startup step is its own feature: one failing is reported, and the window still opens (ADR 0009).
  const failed: string[] = []
  const report = (what: string) => () => failed.push(what)
  const notice = c.store.load()
  guard(log, 'Main workspace adoption', () => c.workspaceRepo.adoptImplicitMainWorkspaces())
  guard(log, 'Chat history', () => c.chatStore.load(), report('Chat history'))
  guard(log, 'Routines', () => c.routines.start(), report('Routines'))
  // Waking up, or plugging in or out, re-checks what is due and whether to keep the computer awake.
  const recheckRoutines = (): void => void guard(log, 'Routines', () => c.routines.tick())
  powerMonitor.on('resume', recheckRoutines)
  powerMonitor.on('on-ac', recheckRoutines)
  powerMonitor.on('on-battery', recheckRoutines)
  // Status detection degrades to PTY heuristics without the hook server (ADR 0006).
  await guard(log, 'Hook server', () => c.hookServer.start())
  container.runtime.on('data', (instanceId, data, offset) => emit('terminal.data', { instanceId, data, offset }))
  container.shells.on('data', (instanceId, data, offset) => emit('terminal.data', { instanceId, data, offset }))
  // What paired devices may do here: REMOTE_CHANNELS only, validated again, folders named directly.
  const serverHandlers = createHandlers(container, { trustPaths: true })
  // Share this computer (ADR 0025): loopback and its Tailscale address, on the default port.
  const share = (on: boolean) => c.sharing.apply(on ? { port: DEFAULT_SERVER_PORT, hosts: ['127.0.0.1'], tailnet: true, handlers: serverHandlers } : null)
  // Every reaction is guarded on its own, so one broken feature never skips the others or fails the save.
  c.settings.on('changed', (next, previous) => {
    if (next.theme !== previous.theme || Boolean(next.wallpaper) !== Boolean(previous.wallpaper)) {
      guard(log, 'Window theme', () => {
        for (const w of BrowserWindow.getAllWindows()) applyWindowTheme(w, next.theme, Boolean(next.wallpaper))
      })
    }
    if (next.autoCheckUpdates !== previous.autoCheckUpdates) guard(log, 'Update checks', () => c.updates.setAutoCheck(next.autoCheckUpdates))
    // A headless server keeps the addresses it was started with.
    if (next.shareOnTailnet !== previous.shareOnTailnet && servePort === undefined) void guard(log, 'Sharing', () => share(next.shareOnTailnet))
    if (next.computerUse && !previous.computerUse) guard(log, 'Computer use', () => c.computer.warm())
    if (!next.computerUse && previous.computerUse) guard(log, 'Computer use', () => c.computer.dispose())
    if (next.queenGlobalShortcut !== previous.queenGlobalShortcut || next.queenShortcut !== previous.queenShortcut) {
      guard(log, 'Queen Bee shortcut', () => c.hotkey.apply(next.queenGlobalShortcut, next.queenShortcut))
    }
  })
  const startup = c.settings.get()
  guard(log, 'Update checks', () => c.updates.setAutoCheck(startup.autoCheckUpdates))
  if (startup.computerUse) guard(log, 'Computer use', () => c.computer.warm(), report('Computer use'))
  if (startup.queenGlobalShortcut) guard(log, 'Queen Bee shortcut', () => c.hotkey.apply(true, startup.queenShortcut), report("Queen Bee's shortcut"))
  registerIpc(
    createHandlers(container),
    (event) => isTrustedSenderUrl(event.senderFrame?.url, targets.devServerUrl, targets.rendererFile),
    log
  )
  if (servePort !== undefined) {
    // Server mode: no window; paired clients drive it (only REMOTE_CHANNELS, validated again).
    await c.sharing.apply({ port: Number(servePort) || 0, hosts: [serveHost], tailnet: serveTailnet, handlers: serverHandlers })
    // Supervisors and the person starting it read the addresses and the pairing code from stdout.
    const shared = c.sharing.status()
    console.log(`Hiveory server ready on ${serveHost}:${shared.port}${shared.address ? ` and ${shared.address}:${shared.port} (Tailscale)` : ''}`)
    if (serveTailnet && !shared.address) console.log(`${shared.detail ?? 'Tailscale is not connected.'} Clients can reach it once it is.`)
  } else {
    openWindow()
    if (startup.shareOnTailnet) void guard(log, 'Sharing', () => share(true))
  }
  // Durable sessions: every agent comes back on its own, resuming its conversation.
  guard(log, 'Agent resume', () => c.agents.resumeAll(), report('Resuming agents'))
  const notices = [
    ...(notice ? [notice] : []),
    ...(failed.length ? [`${failed.join(', ')} failed to start. Everything else works; details are in the log.`] : [])
  ]
  if (notices.length) {
    window?.webContents.once('did-finish-load', () => {
      for (const message of notices) emit('app.notice', { level: 'warning', message })
    })
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
    else tray.show()
  })
})

app.on('window-all-closed', () => {
  // A server has no windows to close; it runs until stopped.
  if (process.platform !== 'darwin' && servePort === undefined) app.quit()
})

app.on('before-quit', () => {
  quitting = true
  tray.destroy()
  guard(log, 'Client shutdown', () => stopClient?.())
  guard(log, 'Server shutdown', () => container?.sharing.stop())
  const c = container
  if (!c) return
  // One disposer failing must not skip the rest — above all the final state flush.
  guard(log, 'Browser shutdown', () => c.browser.closeAll())
  guard(log, 'Computer shutdown', () => c.computer.dispose())
  guard(log, 'Hotkey shutdown', () => c.hotkey.stop())
  guard(log, 'MCP gateway shutdown', () => c.gateway.closeAll())
  guard(log, 'File watcher shutdown', () => c.files.closeAll())
  guard(log, 'Agent shutdown', () => c.runtime.disposeAll())
  guard(log, 'Terminal shutdown', () => c.shells.disposeAll())
  guard(log, 'Terminal host shutdown', () => c.localHost.dispose())
  guard(log, 'Remote host shutdown', () => c.hosts.closeAll())
  guard(log, 'SSH questions shutdown', () => c.sshAuth.close())
  guard(log, 'Port forwards shutdown', () => c.ports.closeAll())
  guard(log, 'Bot computer tunnels', () => c.computers.closeAll())
  guard(log, 'Routine scheduler shutdown', () => c.routines.dispose())
  guard(log, 'Chat shutdown', () => c.chats.stopAll())
  guard(log, 'Hook server shutdown', () => c.hookServer.stop())
  guard(log, 'State flush', () => c.store.flush())
})
