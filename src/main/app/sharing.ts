import type { ShareStatus, TailnetDevice } from '@shared/domain/tailnet'
import type { Handlers } from '../ipc/router'
import type { Tailscale } from '../services/tailscale/tailscale'
import type { Logger } from './logger'
import { startServer, type HiveoryServer } from './server'

/** How often the Tailscale address is re-read: it appears late after boot and can change after a re-login. */
const FOLLOW_MS = 30_000

export interface ShareOptions {
  port: number
  /** Always-on addresses (loopback, for SSH tunnels and this machine). */
  hosts: string[]
  /** Also listen on this machine's Tailscale address and let the owner's devices pair without a code. */
  tailnet: boolean
  handlers: Handlers
}

/**
 * This machine serving Hiveory to the user's other devices (ADR 0022, 0025):
 * the headless `--serve` mode and the desktop's "Share this computer". It
 * listens on loopback and, with `tailnet`, on the Tailscale address only — never
 * on every interface — and follows that address as it comes and goes.
 */
export class Sharing {
  private server: HiveoryServer | null = null
  private options: ShareOptions | null = null
  private self: TailnetDevice | undefined
  private state: ShareStatus['state'] = 'off'
  private detail: string | undefined
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly tailscale: Tailscale,
    private readonly log: Logger,
    private readonly devicesFile: string,
    private readonly version: string
  ) {}

  get port(): number | undefined {
    return this.server?.port
  }

  /** Starts (or stops, with null) serving; throws when the port cannot be opened. */
  async apply(options: ShareOptions | null): Promise<void> {
    this.stop()
    if (!options) return
    this.options = options
    try {
      this.server = await startServer({
        port: options.port,
        hosts: options.hosts,
        handlers: options.handlers,
        log: this.log,
        devicesFile: this.devicesFile,
        version: this.version,
        ownerPairing: options.tailnet ? (address) => this.isOwnersDevice(address) : undefined
      })
    } catch (error) {
      this.state = 'error'
      this.detail = (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${options.port} is in use (is another Hiveory serving?).` : 'Could not start sharing.'
      throw error
    }
    this.state = 'on'
    if (!options.tailnet) return
    await this.follow()
    this.timer = setInterval(() => void this.follow(), FOLLOW_MS)
  }

  status(): ShareStatus {
    if (!this.server) return { state: this.state, detail: this.detail, devices: [] }
    return {
      state: this.state,
      address: this.self ? this.self.dnsName || this.self.ip : undefined,
      port: this.server.port,
      code: this.server.pairingCode(),
      owner: this.self?.owner || undefined,
      devices: this.server.devices(),
      detail: this.detail
    }
  }

  revoke(id: string): void {
    this.server?.revoke(id)
  }

  broadcast(event: string, payload: unknown): void {
    this.server?.broadcast(event, payload)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.server?.close()
    this.server = null
    this.self = undefined
    this.state = 'off'
    this.detail = undefined
  }

  private async follow(): Promise<void> {
    const status = await this.tailscale.status()
    const server = this.server
    if (!server || !this.options) return
    this.self = status.self
    this.state = status.self ? 'on' : 'no-tailscale'
    this.detail =
      status.state === 'missing' ? 'Tailscale is not installed on this computer.' : status.state === 'stopped' ? 'Tailscale is off or signed out on this computer.' : undefined
    await server.setHosts([...this.options.hosts, ...(status.self ? [status.self.ip] : [])])
  }

  /** The connecting address belongs to the same Tailscale login as this machine (tagged machines have no owner). */
  private async isOwnersDevice(address: string): Promise<boolean> {
    const [owner, status] = await Promise.all([this.tailscale.ownerOf(address), this.tailscale.status()])
    return owner !== '' && owner === status.self?.owner
  }
}
