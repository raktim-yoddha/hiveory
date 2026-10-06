import { app, BrowserWindow, clipboard, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { isPluginHelpUrl } from '@shared/domain'
import { fail } from '@shared/errors'
import { CHANNELS, IPC_PREFIX, type Channel } from '@shared/ipc/contract'
import { CLIENT_LOCAL_CHANNELS, REMOTE_CHANNELS } from '@shared/ipc/remote'
import { registerIpc, type Handlers } from '../ipc/router'
import { isTrustedSenderUrl } from '../ipc/trust'
import { SshHostConnector } from '../services/hosts/ssh-host'
import { clearClientConfig, connectAndSave, describeServer, openBase, RemoteBackend, type ClientConfig } from './client'
import type { Logger } from './logger'
import type { AppPaths } from './paths'
import { createMainWindow, type rendererTargets } from './window'

/** Relaunches into the new mode (automation passes HIVEORY_NO_RELAUNCH and starts the app itself). */
export const relaunch = (): void => {
  setTimeout(() => {
    if (!process.env.HIVEORY_NO_RELAUNCH) app.relaunch()
    app.exit(0)
  }, 300)
}

export const sshOptions = (): string[] => (process.env.HIVEORY_SSH_CONFIG ? ['-F', process.env.HIVEORY_SSH_CONFIG] : [])

/**
 * This desktop as a client of a Hiveory server (ADR 0022). No local services
 * start: the window's calls go to the server (REMOTE_CHANNELS only; it checks
 * them again), its events come back over one stream, and a few things stay on
 * this machine — its clipboard, links, and switching servers. The renderer is
 * the same app; it only learns it is a client from app.info.
 */
export const runClientMode = async (config: ClientConfig, paths: AppPaths, log: Logger, targets: ReturnType<typeof rendererTargets>): Promise<() => void> => {
  const ssh = new SshHostConnector(join(import.meta.dirname, 'host.js'), log, sshOptions())
  const server = describeServer(config)
  const send = (event: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(IPC_PREFIX + event, payload)
    }
  }
  let opened: { base: string; close(): void } = { base: 'http://127.0.0.1:0', close: () => undefined }
  try {
    opened = await openBase(config, ssh)
  } catch (error) {
    log.warn(`Could not reach the Hiveory server ${server}`, error)
  }
  const backend = new RemoteBackend(
    opened.base,
    config.token,
    ({ event, payload }) => send(event, payload),
    (connected) => send('app.notice', { level: connected ? 'info' : 'warning', message: connected ? `Connected to the Hiveory server ${server}.` : `Lost the Hiveory server ${server}; reconnecting…` }),
    log,
    async () => {
      opened.close()
      opened = await openBase(config, ssh)
      return opened.base
    }
  )
  void backend.run()

  const local: Partial<Handlers> = {
    'app.info': () => ({ platform: process.platform as 'win32' | 'darwin' | 'linux', version: app.getVersion(), hooksAvailable: true, isDev: !app.isPackaged, client: { server } }),
    'clipboard.readText': () => clipboard.readText(),
    'clipboard.writeText': ({ text }) => clipboard.writeText(text),
    'system.openUrl': async ({ url }) => {
      if (!isPluginHelpUrl(url)) fail('FORBIDDEN', 'Hiveory only opens plugin help pages from here.')
      await shell.openExternal(url)
    },
    'updates.status': () => ({ state: 'unsupported' as const, reason: 'This window uses a Hiveory server. Update Hiveory on each machine.' }),
    'voice.status': () => [],
    'browser.state': () => ({ pages: [], profiles: [], annotations: [] }),
    'wallpapers.list': () => [],
    'client.status': () => ({ mode: 'client' as const, server, connected: backend.isConnected }),
    'client.connect': async (input) => {
      const next = await connectAndSave(input, ssh, paths.clientFile, safeStorage)
      relaunch()
      return { mode: 'client' as const, server: next, connected: true }
    },
    'client.disconnect': () => {
      clearClientConfig(paths.clientFile)
      relaunch()
    }
  }
  const handlers = Object.fromEntries(
    CHANNELS.map((channel: Channel) => [
      channel,
      CLIENT_LOCAL_CHANNELS.has(channel) && local[channel]
        ? local[channel]
        : REMOTE_CHANNELS.has(channel)
          ? (input: unknown) => backend.call(channel, input)
          : () => fail('INVALID_INPUT', 'Not available while this window uses a Hiveory server.', { hint: 'It works on the server itself, or after Disconnect in Settings › Remote.' })
    ])
  ) as unknown as Handlers
  registerIpc(handlers, (event) => isTrustedSenderUrl(event.senderFrame?.url, targets.devServerUrl, targets.rendererFile), log)
  createMainWindow(targets, log, undefined, false)
  log.info(`Client mode: using the Hiveory server ${server}`)
  return () => {
    backend.stop()
    opened.close()
  }
}
