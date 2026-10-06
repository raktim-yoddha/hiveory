import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { AppException, fail, type Result } from '@shared/errors'
import type { Channel } from '@shared/ipc/contract'
import type { ServerEvent } from '@shared/ipc/remote'
import type { SshHostConnector } from '../services/hosts/ssh-host'
import type { Logger } from './logger'

/** Where a Hiveory server is: a loopback port on an SSH host (tunnelled), or an address. */
export type ServerAddress = { via: 'ssh'; destination: string; port: number } | { via: 'direct'; url: string }

/** How this desktop reaches its Hiveory server; the token is sealed by the OS keychain. */
export type ClientConfig = ServerAddress & { token: string }

export interface Sealer {
  isEncryptionAvailable(): boolean
  encryptString(text: string): Buffer
  decryptString(data: Buffer): string
}

export const describeServer = (config: ServerAddress): string => (config.via === 'ssh' ? `${config.destination}:${config.port} (over SSH)` : config.url)

export const readClientConfig = (file: string, sealer: Sealer): ClientConfig | null => {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as ClientConfig & { sealed?: string }
    const token = raw.sealed && sealer.isEncryptionAvailable() ? sealer.decryptString(Buffer.from(raw.sealed, 'base64')) : ''
    if (!token) return null
    return { ...raw, token } as ClientConfig
  } catch {
    return null
  }
}

export const writeClientConfig = (file: string, config: ClientConfig, sealer: Sealer): void => {
  if (!sealer.isEncryptionAvailable()) fail('FORBIDDEN', 'This computer cannot store the server key securely.', { hint: 'Enable the OS keychain (Secret Service on Linux) and try again.' })
  const { token, ...rest } = config
  writeFileSync(file, JSON.stringify({ ...rest, sealed: sealer.encryptString(token).toString('base64') }), { mode: 0o600 })
}

export const clearClientConfig = (file: string): void => rmSync(file, { force: true })

/** The server's base URL from here: an SSH tunnel to its loopback port, or its address. */
export const openBase = async (config: ServerAddress, ssh: SshHostConnector): Promise<{ base: string; close(): void }> => {
  if (config.via === 'direct') return { base: config.url.replace(/\/+$/, ''), close: () => undefined }
  const tunnel = await ssh.forward({ destination: config.destination }, '127.0.0.1', config.port)
  return { base: `http://127.0.0.1:${tunnel.port}`, close: tunnel.close }
}

/** Trades the server's one-time pairing code for this device's token. */
export const pair = async (base: string, code: string): Promise<string> => {
  const health = await fetch(`${base}/health`).catch(() => null)
  const info = (await health?.json().catch(() => null)) as { app?: string } | null
  if (!health?.ok || info?.app !== 'hiveory') fail('NOT_FOUND', 'No Hiveory server answers there.', { hint: 'Start it with "hiveory --serve" and check the port.' })
  const res = await fetch(`${base}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.toUpperCase(), name: hostname() }) })
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
  if (!res.ok || !body.token) fail('FORBIDDEN', body.error ?? 'The server refused the pairing.')
  return body.token!
}

/**
 * This desktop as a client of a Hiveory server: calls are forwarded as they
 * are (the server validates them again), and the server's events stream back
 * and are delivered to the window. The stream reconnects on its own.
 */
export class RemoteBackend {
  private stopped = false
  private connected = false

  constructor(
    private base: string,
    private readonly token: string,
    private readonly onEvent: (event: ServerEvent) => void,
    private readonly onConnection: (connected: boolean) => void,
    private readonly log: Logger,
    /** Opens the way to the server again (a new SSH tunnel) after it dropped. */
    private readonly reopen: () => Promise<string>
  ) {}

  get isConnected(): boolean {
    return this.connected
  }

  async call(channel: Channel, payload: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(`${this.base}/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ channel, payload })
      })
    } catch {
      fail('NOT_FOUND', 'The Hiveory server is not reachable right now.', { hint: 'It reconnects on its own; try again in a moment.' })
    }
    if (res!.status === 401) fail('FORBIDDEN', 'The server no longer knows this device.', { hint: 'Disconnect in Settings › Remote and pair again.' })
    const result = (await res!.json()) as Result<unknown>
    if (!result.ok) throw new AppException(result.error)
    return result.value
  }

  /** Keeps one event stream open, reconnecting (and reopening the tunnel) when it drops. */
  async run(): Promise<void> {
    let delay = 1000
    while (!this.stopped) {
      try {
        const res = await fetch(`${this.base}/events`, { headers: { authorization: `Bearer ${this.token}` } })
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`)
        this.setConnected(true)
        delay = 1000
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let end = buffer.indexOf('\n\n')
          while (end >= 0) {
            const frame = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
            if (data) {
              try {
                this.onEvent(JSON.parse(data) as ServerEvent)
              } catch (error) {
                this.log.warn('Ignored a malformed server event', error)
              }
            }
            end = buffer.indexOf('\n\n')
          }
        }
      } catch (error) {
        if (this.stopped) return
        this.log.warn(`Server event stream dropped: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.setConnected(false)
      if (this.stopped) return
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(30_000, delay * 2)
      try {
        this.base = await this.reopen()
      } catch (error) {
        this.log.warn('Could not reopen the way to the server', error)
      }
    }
  }

  stop(): void {
    this.stopped = true
  }

  private setConnected(connected: boolean): void {
    if (connected === this.connected) return
    this.connected = connected
    this.onConnection(connected)
  }
}

export type ConnectRequest = { via: 'ssh'; destination: string; port: number; code: string } | { via: 'direct'; url: string; code: string }

/** Pairs with a server and saves how to reach it (token sealed). The app then relaunches as its client. */
export const connectAndSave = async (request: ConnectRequest, ssh: SshHostConnector, file: string, sealer: Sealer): Promise<string> => {
  const where: ServerAddress = request.via === 'ssh' ? { via: 'ssh', destination: request.destination, port: request.port } : { via: 'direct', url: request.url }
  const opened = await openBase(where, ssh)
  try {
    const token = await pair(opened.base, request.code)
    writeClientConfig(file, { ...where, token }, sealer)
  } finally {
    opened.close()
  }
  return describeServer(where)
}
