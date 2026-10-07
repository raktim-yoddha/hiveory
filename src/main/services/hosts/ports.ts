import { hostKey, type HostRef } from '@shared/domain'
import { fail } from '@shared/errors'
import type { RemotePort } from '@shared/domain/tailnet'
import type { HostKit } from './host-kit'

/** SSH itself is never offered. */
const HIDDEN = new Set([22])

/** Listening TCP ports from /proc/net/tcp and tcp6 (state 0A = LISTEN). */
export const parseProcNetTcp = (text: string): Array<{ port: number; address: string }> => {
  const found = new Map<number, string>()
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 4 || cols[3] !== '0A') continue
    const [hexAddress = '', hexPort = ''] = (cols[1] ?? '').split(':')
    const port = parseInt(hexPort, 16)
    if (!Number.isInteger(port) || port <= 0) continue
    // Little-endian IPv4; IPv6 only matters as loopback (::1) or any (::).
    const address =
      hexAddress.length === 8
        ? hexAddress.match(/../g)!.reverse().map((b) => parseInt(b, 16)).join('.')
        : /^0+$/.test(hexAddress)
          ? '::'
          : hexAddress === '00000000000000000000000001000000'
            ? '::1'
            : 'ipv6'
    if (!found.has(port) || found.get(port) === '127.0.0.1') found.set(port, address)
  }
  return [...found].map(([port, address]) => ({ port, address }))
}

/** Listening TCP ports from `lsof -nP -iTCP -sTCP:LISTEN -F n` (macOS). */
export const parseLsofListen = (text: string): Array<{ port: number; address: string }> => {
  const found = new Map<number, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^n(.*):(\d+)$/.exec(line.trim())
    if (!match) continue
    const port = Number(match[2])
    if (!found.has(port)) found.set(port, match[1]!.replace(/^\[|\]$/g, ''))
  }
  return [...found].map(([port, address]) => ({ port, address }))
}

/**
 * Ports on a remote project's machine (ADR 0025, Orca's Ports tab): what is
 * listening there, and one-click forwards to this computer's loopback — the
 * same port number when it is free (privileged ports move up by 10000).
 */
export class PortForwards {
  private readonly forwards = new Map<string, { localPort: number; close(): void }>()

  constructor(private readonly kitFor: (host: HostRef) => Promise<HostKit>) {}

  async list(host: HostRef): Promise<RemotePort[]> {
    const kit = await this.kitFor(host)
    const linux = await kit.exec({ file: 'cat', args: ['/proc/net/tcp', '/proc/net/tcp6'], timeoutMs: 10_000 })
    const listening =
      linux.code === 0 && linux.stdout.trim()
        ? parseProcNetTcp(linux.stdout)
        : parseLsofListen((await kit.exec({ file: 'lsof', args: ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'n'], timeoutMs: 10_000 })).stdout)
    // Hiveory's own tunnel for agents' status hooks listens there too; it is not the user's.
    const hook = kit.hook()
    const own = hook ? Number(new URL(hook.baseUrl).port) : 0
    return listening
      .filter((p) => !HIDDEN.has(p.port) && p.port !== own)
      .sort((a, b) => a.port - b.port)
      .map((p) => ({ ...p, localPort: this.forwards.get(this.key(host, p.port))?.localPort }))
  }

  async forward(host: HostRef, port: number): Promise<number> {
    const key = this.key(host, port)
    const existing = this.forwards.get(key)
    if (existing) return existing.localPort
    const kit = await this.kitFor(host)
    if (!kit.remote) fail('INVALID_INPUT', 'Ports are forwarded from remote workspaces only.')
    // `localhost` on the remote reaches servers bound to 127.0.0.1, ::1 or every address.
    const tunnel = await kit.forward('localhost', port, port < 1024 ? port + 10000 : port)
    this.forwards.set(key, { localPort: tunnel.port, close: tunnel.close })
    return tunnel.port
  }

  /** The local port of an active forward (only those can be opened). */
  localPort(host: HostRef, port: number): number | undefined {
    return this.forwards.get(this.key(host, port))?.localPort
  }

  stop(host: HostRef, port: number): void {
    const key = this.key(host, port)
    this.forwards.get(key)?.close()
    this.forwards.delete(key)
  }

  closeAll(): void {
    for (const f of this.forwards.values()) f.close()
    this.forwards.clear()
  }

  private key(host: HostRef, port: number): string {
    return `${hostKey(host)}#${port}`
  }
}
