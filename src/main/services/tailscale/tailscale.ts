import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { TailnetDevice, TailnetStatus } from '@shared/domain/tailnet'
import { findExecutable, processDiscoveryEnv } from '../cli/discovery'

/** Where Tailscale installs its CLI when it is not on PATH (the macOS app ships it inside the bundle). */
const KNOWN_PATHS: Partial<Record<NodeJS.Platform, string[]>> = {
  win32: ['C:\\Program Files\\Tailscale\\tailscale.exe'],
  darwin: ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'],
  linux: ['/usr/bin/tailscale', '/usr/local/bin/tailscale', '/usr/sbin/tailscale']
}

/** Tailscale's own address ranges: 100.64.0.0/10 and fd7a:115c:a1e0::/48. Nothing else can be a tailnet peer. */
export const isTailnetAddress = (address: string): boolean => {
  const ip = address.replace(/^::ffff:/, '')
  const v4 = /^100\.(\d+)\.\d+\.\d+$/.exec(ip)
  if (v4) return Number(v4[1]) >= 64 && Number(v4[1]) <= 127
  return ip.toLowerCase().startsWith('fd7a:115c:a1e0:')
}

/** Tagged nodes (servers) belong to the tailnet, not to a person: they never count as anyone's own device. */
const TAGGED = 'tagged-devices'

interface RawNode {
  HostName?: string
  DNSName?: string
  TailscaleIPs?: string[]
  OS?: string
  Online?: boolean
  UserID?: number
  Tags?: string[]
}

const device = (node: RawNode, users: Record<string, { LoginName?: string }>, self: boolean): TailnetDevice | null => {
  const ip = node.TailscaleIPs?.find((a) => !a.includes(':')) ?? node.TailscaleIPs?.[0]
  if (!ip) return null
  const login = users[String(node.UserID)]?.LoginName ?? ''
  return {
    name: node.HostName || node.DNSName?.split('.')[0] || ip,
    dnsName: (node.DNSName ?? '').replace(/\.$/, ''),
    ip,
    os: node.OS ?? '',
    online: self || Boolean(node.Online),
    owner: node.Tags?.length || login === TAGGED ? '' : login
  }
}

/** `tailscale status --json` → the normalized tailnet: this device and its peers, online first. */
export const parseStatus = (json: string): TailnetStatus => {
  const raw = JSON.parse(json) as {
    BackendState?: string
    Self?: RawNode
    Peer?: Record<string, RawNode>
    User?: Record<string, { LoginName?: string }>
  }
  if (raw.BackendState !== 'Running' || !raw.Self) return { state: 'stopped', devices: [] }
  const users = raw.User ?? {}
  const self = device(raw.Self, users, true)
  const devices = Object.values(raw.Peer ?? {})
    .map((p) => device(p, users, false))
    .filter((d): d is TailnetDevice => d !== null)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  return self ? { state: 'running', self, devices } : { state: 'stopped', devices: [] }
}

/** `tailscale whois --json <ip>` → the login of the person that peer belongs to ('' for tagged nodes). */
export const parseWhois = (json: string): string => {
  const raw = JSON.parse(json) as {
    Node?: { Tags?: string[] }
    UserProfile?: { LoginName?: string }
  }
  const login = raw.UserProfile?.LoginName ?? ''
  return raw.Node?.Tags?.length || login === TAGGED ? '' : login
}

/**
 * The user's own Tailscale, read through its CLI (ADR 0025). Hiveory never
 * signs in, changes tailnet settings or stores anything of Tailscale's: it
 * only reads who is on the tailnet and who a connecting address belongs to.
 */
export class Tailscale {
  private binary: string | null | undefined

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  private locate(): string | null {
    if (this.binary !== undefined) return this.binary
    this.binary = findExecutable('tailscale', processDiscoveryEnv()) ?? KNOWN_PATHS[this.platform]?.find((p) => existsSync(p)) ?? null
    return this.binary
  }

  private run(args: string[]): Promise<string> {
    const binary = this.locate()
    if (!binary) return Promise.reject(new Error('missing'))
    return new Promise((resolve, reject) =>
      execFile(binary, args, { timeout: 5000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout.toString())))
    )
  }

  async status(): Promise<TailnetStatus> {
    if (!this.locate()) return { state: 'missing', devices: [] }
    try {
      return parseStatus(await this.run(['status', '--json']))
    } catch {
      // Installed but the daemon is off or logged out: `status` exits non-zero.
      return { state: 'stopped', devices: [] }
    }
  }

  /** The person a tailnet address belongs to, or '' (not a tailnet address, a tagged node, or unknown). */
  async ownerOf(address: string): Promise<string> {
    if (!isTailnetAddress(address)) return ''
    try {
      return parseWhois(await this.run(['whois', '--json', address.replace(/^::ffff:/, '')]))
    } catch {
      return ''
    }
  }
}
