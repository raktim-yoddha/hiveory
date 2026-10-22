import { createSocket, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import type { LanServer } from '@shared/domain/tailnet'
import { DEFAULT_SERVER_PORT } from '@shared/ipc/remote'
import type { Logger } from './logger'

/**
 * Finding a shared Hiveory on the same Wi-Fi or office network (ADR 0052), as Tailscale finds the
 * user's tailnet devices. A client broadcasts one UDP probe on the server port; a computer that
 * shares on its local network answers with its name, port and version, nothing else. Pairing still
 * takes the computer's one-time code: being found is not being trusted.
 */
export const PROBE = 'hiveory-discover-1'
const MAX_REPLY = 512
/** One answer per asker per second: a probe can never be used to flood a machine. */
const ANSWER_EVERY_MS = 1000

/** RFC 1918 private IPv4 (a home or office network), as Sharing's own check. */
const isPrivate = (ip: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)

/** The directed broadcast address of each local network this machine is on, plus the limited one. */
export const broadcastAddresses = (interfaces = networkInterfaces()): string[] => {
  const out = new Set<string>(['255.255.255.255'])
  for (const i of Object.values(interfaces).flatMap((list) => list ?? [])) {
    if (i.family !== 'IPv4' || i.internal || !isPrivate(i.address)) continue
    const ip = i.address.split('.').map(Number)
    const mask = i.netmask.split('.').map(Number)
    out.add(ip.map((b, n) => (b | (~mask[n]! & 255)) >>> 0).join('.'))
  }
  return [...out]
}

/** The answer a sharing computer gives; null for anything that is not one. */
export const parseAnswer = (message: string, address: string): LanServer | null => {
  try {
    const j = JSON.parse(message) as { app?: unknown; name?: unknown; port?: unknown; version?: unknown }
    if (j.app !== 'hiveory' || typeof j.port !== 'number' || !Number.isInteger(j.port) || j.port < 1 || j.port > 65535) return null
    if (!isPrivate(address)) return null
    const name = typeof j.name === 'string' ? j.name.slice(0, 63) : address
    return { name, address, port: j.port, version: typeof j.version === 'string' ? j.version.slice(0, 32) : '' }
  } catch {
    return null
  }
}

/** Answers probes while this computer shares on its local network; `info` says what to answer. */
export const answerLanProbes = (info: () => { name: string; port: number; version: string } | null, log: Logger): { close(): void } => {
  const socket: Socket = createSocket({ type: 'udp4', reuseAddr: true })
  const answered = new Map<string, number>()
  socket.on('error', (error) => {
    log.warn('Local-network discovery is unavailable', error)
    socket.close()
  })
  socket.on('message', (message, from) => {
    const now = Date.now()
    if (message.length > 64 || message.toString('utf8') !== PROBE || !isPrivate(from.address)) return
    if (now - (answered.get(from.address) ?? 0) < ANSWER_EVERY_MS) return
    answered.set(from.address, now)
    if (answered.size > 1000) answered.clear()
    const me = info()
    if (!me) return
    const reply = Buffer.from(JSON.stringify({ app: 'hiveory', ...me }).slice(0, MAX_REPLY))
    socket.send(reply, from.port, from.address)
  })
  socket.bind(DEFAULT_SERVER_PORT)
  return { close: () => socket.close() }
}

/** The computers on this machine's local networks that share Hiveory, found within `ms`. */
export const findLanServers = (ms = 1200): Promise<LanServer[]> =>
  new Promise((resolve) => {
    // This computer answers its own broadcast when it shares too: never list it.
    const own = new Set(Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((i) => i.address)))
    const found = new Map<string, LanServer>()
    const socket = createSocket('udp4')
    const done = (): void => {
      try {
        socket.close()
      } catch {
        // Closed already.
      }
      resolve([...found.values()])
    }
    socket.on('error', done)
    socket.on('message', (message, from) => {
      const server = parseAnswer(message.toString('utf8'), from.address)
      if (server && !own.has(server.address)) found.set(`${server.address}:${server.port}`, server)
    })
    socket.bind(0, () => {
      socket.setBroadcast(true)
      for (const address of broadcastAddresses()) socket.send(PROBE, DEFAULT_SERVER_PORT, address, () => undefined)
      setTimeout(done, ms)
    })
  })
