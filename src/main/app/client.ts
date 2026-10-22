import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { AppException, fail, type Result } from '@shared/errors'
import type { Channel } from '@shared/ipc/contract'
import type { ServerEvent } from '@shared/ipc/remote'
import { isHostAddress, type DiscoveredDevice, type Discovery, type LanServer } from '@shared/domain/tailnet'
import { DEFAULT_SERVER_PORT } from '@shared/ipc/remote'
import type { SshHostConnector } from '../services/hosts/ssh-host'
import type { Tailscale } from '../services/tailscale/tailscale'
import { findLanServers } from './lan-discovery'
import type { Logger } from './logger'

/** Where a Hiveory server is: a loopback port on an SSH host (tunnelled), an address, or a device on the user's tailnet. */
export type ServerAddress =
  | { via: 'ssh'; destination: string; port: number }
  | { via: 'direct'; url: string; alternates?: string[] }
  | { via: 'tailnet'; ip: string; port: number; name: string; alternates?: string[] }

/** How this desktop reaches its Hiveory server; the token is sealed by the OS keychain. */
export type ClientConfig = ServerAddress & { token: string }

export interface Sealer {
  isEncryptionAvailable(): boolean
  encryptString(text: string): Buffer
  decryptString(data: Buffer): string
}

export const describeServer = (config: ServerAddress): string =>
  config.via === 'ssh' ? `${config.destination}:${config.port} (over SSH)` : config.via === 'tailnet' ? `${config.name} (Tailscale)` : config.url

const hostUrl = (ip: string, port: number): string => `http://${ip.includes(':') ? `[${ip}]` : ip}:${port}`

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

/**
 * The server's base URL from here: an SSH tunnel to its loopback port, or its address. A tailnet
 * device is looked up by name each time, so it is found again if its Tailscale address changed.
 */
export const openBase = async (config: ServerAddress, ssh: SshHostConnector, tailscale: Tailscale, probe: typeof fetch = fetch): Promise<{ base: string; close(): void }> => {
  if (config.via === 'direct') return { base: await firstAnswering([config.url.replace(/\/+$/, ''), ...(config.alternates ?? [])], probe), close: () => undefined }
  if (config.via === 'tailnet') {
    const found = (await tailscale.status().catch(() => null))?.devices.find((d) => d.name === config.name)
    return { base: await firstAnswering([hostUrl(found?.ip ?? config.ip, config.port), ...(config.alternates ?? [])], probe), close: () => undefined }
  }
  const tunnel = await ssh.forward({ destination: config.destination }, '127.0.0.1', config.port)
  return { base: `http://127.0.0.1:${tunnel.port}`, close: tunnel.close }
}

/** How long one address gets to answer before the next is tried. */
const ANSWER_MS = 1500

/**
 * The first base URL that answers as a Hiveory server, in order (ADR 0052): a computer reached
 * over Tailscale and over Wi-Fi is still found when one of the two is off. None answering: the
 * first, so the error names the address the user chose.
 */
export const firstAnswering = async (bases: string[], probe: typeof fetch = fetch): Promise<string> => {
  if (bases.length < 2) return bases[0]!
  for (const base of bases) {
    const ok = await probe(`${base}/health`, { signal: AbortSignal.timeout(ANSWER_MS) })
      .then(async (r) => r.ok && ((await r.json()) as { app?: string }).app === 'hiveory')
      .catch(() => false)
    if (ok) return base
  }
  return bases[0]!
}

/** Trades the server's one-time pairing code (none: the owner's own tailnet device) for this device's token. */
export const pair = async (base: string, code?: string): Promise<{ token: string; addresses: string[] }> => {
  const health = await fetch(`${base}/health`).catch(() => null)
  const info = (await health?.json().catch(() => null)) as { app?: string } | null
  if (!health?.ok || info?.app !== 'hiveory') fail('NOT_FOUND', 'No Hiveory server answers there.', { hint: 'Start it with "hiveory --serve" and check the port.' })
  const res = await fetch(`${base}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code?.toUpperCase(), name: hostname() }) })
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; addresses?: unknown }
  if (!res.ok || !body.token) fail('FORBIDDEN', body.error ?? 'The server refused the pairing.')
  const addresses = Array.isArray(body.addresses) ? body.addresses.filter(isHostAddress).slice(0, 8) : []
  return { token: body.token!, addresses }
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

export type ConnectRequest =
  | { via: 'ssh'; destination: string; port: number; code: string }
  | { via: 'direct'; url: string; code: string }
  | { via: 'tailnet'; ip: string; port: number; name: string; code?: string }

/** Pairs with a server and saves how to reach it (token sealed). The app then relaunches as its client. */
export const connectAndSave = async (request: ConnectRequest, ssh: SshHostConnector, tailscale: Tailscale, file: string, sealer: Sealer): Promise<string> => {
  const where: ServerAddress =
    request.via === 'ssh'
      ? { via: 'ssh', destination: request.destination, port: request.port }
      : request.via === 'tailnet'
        ? { via: 'tailnet', ip: request.ip, port: request.port, name: request.name }
        : { via: 'direct', url: request.url }
  const opened = await openBase(where, ssh, tailscale)
  try {
    const { token, addresses } = await pair(opened.base, request.code)
    // Its other addresses (Tailscale, Wi-Fi), so it is still reached when one way is off (ADR 0052).
    const port = Number(new URL(opened.base).port) || DEFAULT_SERVER_PORT
    const alternates = where.via === 'ssh' ? [] : addresses.map((a) => hostUrl(a, port)).filter((b) => b !== opened.base)
    writeClientConfig(file, { ...where, ...(alternates.length ? { alternates } : {}), token } as ClientConfig, sealer)
  } finally {
    opened.close()
  }
  return describeServer(where)
}

/** How long a tailnet device gets to say it is a Hiveory server (peers answer in milliseconds). */
const PROBE_MS = 1500

/**
 * The user's tailnet devices (ADR 0025), each online one probed once on the default
 * port so the picker can show which ones already run a Hiveory server.
 */
export const discover = async (tailscale: Tailscale, probe: typeof fetch = fetch, lan: () => Promise<LanServer[]> = findLanServers): Promise<Discovery> => {
  // The same Wi-Fi or office network, Tailscale or not (ADR 0052).
  const nearby = lan().catch(() => [])
  const status = await tailscale.status()
  const me = status.self?.owner ?? ''
  const devices = await Promise.all(
    status.devices.map(async (device): Promise<DiscoveredDevice> => {
      const mine = me !== '' && device.owner === me
      if (!device.online) return { ...device, mine }
      const health = await probe(`${hostUrl(device.ip, DEFAULT_SERVER_PORT)}/health`, { signal: AbortSignal.timeout(PROBE_MS) })
        .then((r) => (r.ok ? (r.json() as Promise<{ app?: string; version?: string }>) : null))
        .catch(() => null)
      return health?.app === 'hiveory' ? { ...device, mine, hiveory: { version: health.version ?? '', port: DEFAULT_SERVER_PORT } } : { ...device, mine }
    })
  )
  // Hiveory servers first, then the user's own devices, then the rest.
  devices.sort((a, b) => Number(Boolean(b.hiveory)) - Number(Boolean(a.hiveory)) || Number(b.mine) - Number(a.mine) || Number(b.online) - Number(a.online))
  return { state: status.state, devices, lan: await nearby }
}
