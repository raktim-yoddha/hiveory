import { app, BrowserWindow, clipboard, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { isAppsHelpUrl } from '@shared/domain'
import type { SshPrompt } from '@shared/domain/tailnet'
import { fail } from '@shared/errors'
import { CHANNELS, IPC_PREFIX, type Channel } from '@shared/ipc/contract'
import { CLIENT_LOCAL_CHANNELS, REMOTE_CHANNELS } from '@shared/ipc/remote'
import { registerIpc, type Handlers } from '../ipc/router'
import { isTrustedSenderUrl } from '../ipc/trust'
import { SshAuth } from '../services/hosts/ssh-auth'
import { SshHostConnector } from '../services/hosts/ssh-host'
import { Tailscale } from '../services/tailscale/tailscale'
import { clearClientConfig, connectAndSave, describeServer, discover, openBase, RemoteBackend, type ClientConfig } from './client'
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
  const server = describeServer(config)
  const send = (event: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(IPC_PREFIX + event, payload)
    }
  }
  // The SSH tunnel to the server asks its questions (a password, a code) in this window too (ADR 0025).
  const sshAuth = new SshAuth(paths.runtimeDir, send, log)
  const ssh = new SshHostConnector(join(import.meta.dirname, 'host.js'), log, sshOptions(), undefined, sshAuth)
  const tailscale = new Tailscale()
  // The way to the server opens once the window is up (it may need to ask something); the stream retries until then.
  let opened: { base: string; close(): void } = { base: 'http://127.0.0.1:0', close: () => undefined }
  const backend = new RemoteBackend(
    opened.base,
    config.token,
    ({ event, payload }) => send(event, payload),
    (connected) => send('app.notice', { level: connected ? 'info' : 'warning', message: connected ? `Connected to the Hiveory server ${server}.` : `Lost the Hiveory server ${server}; reconnecting…` }),
    log,
    async () => {
      opened.close()
      opened = await openBase(config, ssh, tailscale)
      return opened.base
    }
  )
  void backend.run()

  const local: Partial<Handlers> = {
    'app.info': () => ({ platform: process.platform as 'win32' | 'darwin' | 'linux', version: app.getVersion(), hooksAvailable: true, isDev: !app.isPackaged, client: { server } }),
    'clipboard.readText': () => clipboard.readText(),
    'clipboard.writeText': ({ text }) => clipboard.writeText(text),
    'system.openUrl': async ({ url }) => {
      if (!isAppsHelpUrl(url)) fail('FORBIDDEN', 'Hiveory only opens the Composio account page from here.')
      await shell.openExternal(url)
    },
    'updates.status': () => ({ state: 'unsupported' as const, reason: 'This window uses a Hiveory server. Update Hiveory on each machine.' }),
    'voice.status': () => [],
    'browser.state': () => ({ pages: [], profiles: [], annotations: [] }),
    'wallpapers.list': () => [],
    'themes.installed': () => [],
    'client.status': () => ({ mode: 'client' as const, server, connected: backend.isConnected }),
    'client.connect': async (input) => {
      const next = await connectAndSave(input, ssh, tailscale, paths.clientFile, safeStorage)
      relaunch()
      return { mode: 'client' as const, server: next, connected: true }
    },
    'client.discover': () => discover(tailscale),
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
  // SSH questions: this window's own (its tunnel) are answered here, the server's there.
  handlers['ssh.answer'] = (input) => (sshAuth.has(input.id) ? sshAuth.answer(input.id, input.answer) : (backend.call('ssh.answer', input) as Promise<void>))
  handlers['ssh.pending'] = async () => [...sshAuth.pending(), ...((await backend.call('ssh.pending', undefined).catch(() => [])) as SshPrompt[])]
  registerIpc(handlers, (event) => isTrustedSenderUrl(event.senderFrame?.url, targets.devServerUrl, targets.rendererFile), log)
  createMainWindow(targets, log, undefined, false)
  log.info(`Client mode: using the Hiveory server ${server}`)
  return () => {
    sshAuth.close()
    backend.stop()
    opened.close()
  }
}
