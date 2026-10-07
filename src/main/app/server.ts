import { createHash, randomBytes, randomInt } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import type { PairedDevice } from '@shared/domain/tailnet'
import { toAppError, type Result } from '@shared/errors'
import { requestSchemas, type Channel } from '@shared/ipc/contract'
import { MOBILE_CHANNELS, PAIRING_TTL_MS, REMOTE_CHANNELS, type DeviceScope, type ServerCall } from '@shared/ipc/remote'
import type { Handlers } from '../ipc/router'
import type { Logger } from './logger'

/** Calls can carry pasted attachments (base64), so the body limit matches chat.attach. */
const MAX_BODY = 40 * 1024 * 1024
const KEEPALIVE_MS = 15_000
/** Wrong pairing codes allowed per window before pairing pauses. */
const MAX_PAIR_FAILURES = 10
const PAIR_WINDOW_MS = 10 * 60_000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

interface Device {
  id: string
  name: string
  tokenHash: string
  pairedAt: string
  /** A phone may only use MOBILE_CHANNELS (ADR 0027). Absent = desktop (paired before scopes existed). */
  scope?: DeviceScope
  /** Where its "needs you" notifications go (an Expo push token), when it asked for them. */
  pushToken?: string
}

/** Expo's push token shape; nothing else is ever stored or sent to. */
const PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/

const hash = (token: string): string => createHash('sha256').update(token).digest('hex')

/** Paired devices, by token hash only: a stolen file holds no usable token. */
class DeviceStore {
  private devices: Device[] = []
  constructor(private readonly file: string) {
    try {
      this.devices = (JSON.parse(readFileSync(file, 'utf8')) as { devices: Device[] }).devices ?? []
    } catch {
      this.devices = []
    }
  }
  find(token: string): Device | undefined {
    const wanted = hash(token)
    return this.devices.find((d) => d.tokenHash === wanted)
  }
  list(): PairedDevice[] {
    return this.devices.map(({ id, name, pairedAt, scope }) => ({ id, name, pairedAt, kind: scope ?? 'desktop' }))
  }
  add(name: string, scope: DeviceScope): string {
    const token = randomBytes(32).toString('base64url')
    this.devices.push({ id: randomBytes(6).toString('hex'), name: name.slice(0, 80), tokenHash: hash(token), pairedAt: new Date().toISOString(), scope })
    this.save()
    return token
  }
  setPushToken(device: Device, pushToken: string | undefined): void {
    device.pushToken = pushToken
    this.save()
  }
  pushTokens(): string[] {
    return this.devices.flatMap((d) => (d.pushToken ? [d.pushToken] : []))
  }
  /** Expo said a token is gone (app removed): stop sending to it. */
  dropPushToken(pushToken: string): void {
    for (const d of this.devices) if (d.pushToken === pushToken) d.pushToken = undefined
    this.save()
  }
  /** Forgets a device; returns its token hash so its open streams can be closed. */
  remove(id: string): string | undefined {
    const device = this.devices.find((d) => d.id === id)
    if (!device) return undefined
    this.devices = this.devices.filter((d) => d !== device)
    this.save()
    return device.tokenHash
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ devices: this.devices }, null, 2), { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
  }
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('bad json'))
      }
    })
    req.on('error', reject)
  })

export interface HiveoryServer {
  port: number
  /** The current pairing code (a fresh one replaces it after each pairing or when it expires). */
  pairingCode(): string
  devices(): PairedDevice[]
  /** Unpairs a device and ends its open event streams at once. */
  revoke(id: string): void
  /** Listens on exactly these addresses (same port), e.g. when the Tailscale address appears or changes. */
  setHosts(hosts: string[]): Promise<void>
  broadcast(event: string, payload: unknown): void
  /** Paired phones that want "needs you" notifications (ADR 0027). */
  pushTokens(): string[]
  dropPushToken(token: string): void
  close(): void
}

export interface ServerOptions {
  port: number
  /** Addresses to listen on; the first one picks the port (0 = any free one). */
  hosts: string[]
  handlers: Handlers
  log: Logger
  devicesFile: string
  version: string
  /**
   * Code-less pairing (ADR 0025): true when the connecting socket address is one
   * of the owner's own devices, as Tailscale reports it.
   */
  ownerPairing?: (remoteAddress: string) => Promise<boolean>
}

/**
 * Hiveory as a server (ADR 0022): the whole app runs on this machine (a VM,
 * a box under the desk) and desktop clients use it over HTTP — calls as POST,
 * events as one Server-Sent Events stream. It binds to loopback by default, so
 * clients reach it through an SSH tunnel; pairing trades a short one-time code
 * for a device token. Every call is a REMOTE_CHANNELS channel and is validated
 * with the same schemas as local IPC.
 */
export const startServer = async (options: ServerOptions): Promise<HiveoryServer> => {
  const { handlers, log } = options
  const devices = new DeviceStore(options.devicesFile)
  /** Open event streams: who opened each (for revocation) and which terminal output it wants. */
  const streams = new Map<ServerResponse, { tokenHash: string; terminal?: string }>()
  let code = ''
  let codeUntil = 0
  let failures: number[] = []
  const freshCode = (): string => {
    code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
    codeUntil = Date.now() + PAIRING_TTL_MS
    log.info(`Hiveory server pairing code: ${code} (valid 15 minutes, single use)`)
    // Whoever started the server reads the current code from its console.
    console.log(`Pairing code: ${code} (single use, 15 minutes)`)
    return code
  }
  const currentCode = (): string => (Date.now() > codeUntil ? freshCode() : code)
  freshCode()

  const deviceOf = (req: IncomingMessage): Device | undefined => {
    const header = req.headers.authorization ?? ''
    return header.startsWith('Bearer ') ? devices.find(header.slice(7)) : undefined
  }

  const call = async (body: ServerCall, device: Device): Promise<Result<unknown>> => {
    const channel = body.channel as Channel
    if (!REMOTE_CHANNELS.has(channel)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Not available from a client.' } }
    if (device.scope === 'mobile' && !MOBILE_CHANNELS.has(channel)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Do that on the computer itself.' } }
    const parsed = requestSchemas[channel].safeParse(body.payload)
    if (!parsed.success) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid request.', detail: parsed.error.message } }
    try {
      const handler = handlers[channel] as (input: unknown, event: IpcMainInvokeEvent) => unknown
      return { ok: true, value: (await handler(parsed.data, {} as IpcMainInvokeEvent)) ?? null }
    } catch (error) {
      const appError = toAppError(error)
      if (appError.code === 'UNEXPECTED') log.error(`Server call ${channel} failed`, error)
      return { ok: false, error: appError }
    }
  }

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://hiveory')
    void (async () => {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, app: 'hiveory', version: options.version })
      if (req.method === 'POST' && url.pathname === '/pair') {
        const now = Date.now()
        failures = failures.filter((t) => now - t < PAIR_WINDOW_MS)
        if (failures.length >= MAX_PAIR_FAILURES) return json(res, 429, { error: 'Too many wrong codes. Try again later.' })
        const body = (await readBody(req)) as { code?: unknown; name?: unknown; client?: unknown }
        const name = typeof body.name === 'string' ? body.name : 'Desktop'
        // A phone gets the phone's channels only (ADR 0027); it cannot ask for more.
        const scope: DeviceScope = body.client === 'mobile' ? 'mobile' : 'desktop'
        if (body.code === undefined) {
          // No code: only the owner's own devices, proven by Tailscale from the socket address (never from the request).
          if (options.ownerPairing && (await options.ownerPairing(req.socket.remoteAddress ?? ''))) {
            log.info("One of the owner's devices paired with this Hiveory server")
            return json(res, 200, { token: devices.add(name, scope) })
          }
          failures.push(now)
          return json(res, 403, { error: 'This device needs the pairing code that computer shows.', needsCode: true })
        }
        if (typeof body.code !== 'string' || body.code.toUpperCase() !== currentCode()) {
          failures.push(now)
          return json(res, 403, { error: 'That pairing code is wrong or has expired.', needsCode: true })
        }
        const token = devices.add(name, scope)
        log.info('A device paired with this Hiveory server')
        freshCode()
        return json(res, 200, { token })
      }
      const device = deviceOf(req)
      if (!device) return json(res, 401, { error: 'Pair this device first.' })
      if (req.method === 'POST' && url.pathname === '/call') return json(res, 200, await call((await readBody(req)) as ServerCall, device))
      // Where this device's "needs you" notifications go (an Expo push token), or null to stop them.
      if (req.method === 'POST' && url.pathname === '/push') {
        const { token } = (await readBody(req)) as { token?: unknown }
        if (token !== null && (typeof token !== 'string' || !PUSH_TOKEN.test(token))) return json(res, 400, { error: 'Not a push token.' })
        devices.setPushToken(device, token ?? undefined)
        return json(res, 200, { ok: true })
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        res.write('retry: 2000\n\n')
        // A phone's data plan matters: ?terminal=<id> streams one terminal only, ?terminal=none every event but terminal output.
        const terminal = url.searchParams.get('terminal')
        streams.set(res, { tokenHash: device.tokenHash, terminal: terminal && /^[A-Za-z0-9_-]{1,128}$/.test(terminal) ? terminal : undefined })
        const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS)
        req.on('close', () => {
          clearInterval(keepalive)
          streams.delete(res)
        })
        return
      }
      json(res, 404, { error: 'Not found.' })
    })().catch((error: unknown) => {
      if (!res.headersSent) json(res, 400, { error: error instanceof Error ? error.message : 'Bad request.' })
    })
  }

  const listen = (port: number, host: string): Promise<Server> =>
    new Promise((resolve, reject) => {
      const server = createServer(handle)
      server.once('error', reject)
      server.listen(port, host, () => {
        log.info(`Hiveory server listening on ${host}:${(server.address() as { port: number }).port}`)
        resolve(server)
      })
    })

  const [first = '127.0.0.1', ...rest] = options.hosts
  const listeners = new Map<string, Server>([[first, await listen(options.port, first)]])
  const port = (listeners.get(first)!.address() as { port: number }).port
  const setHosts = async (hosts: string[]): Promise<void> => {
    for (const [host, server] of listeners) {
      if (hosts.includes(host)) continue
      server.close()
      listeners.delete(host)
    }
    for (const host of hosts) {
      if (listeners.has(host)) continue
      // An extra address failing (e.g. Tailscale going down meanwhile) never stops the others.
      await listen(port, host).then(
        (server) => listeners.set(host, server),
        (error: unknown) => log.warn(`Hiveory server could not listen on ${host}:${port}`, error)
      )
    }
  }
  await setHosts([first, ...rest])

  return {
    port,
    pairingCode: currentCode,
    devices: () => devices.list(),
    revoke: (id) => {
      const tokenHash = devices.remove(id)
      for (const [s, meta] of streams) if (meta.tokenHash === tokenHash) s.end()
    },
    setHosts,
    broadcast: (event, payload) => {
      if (!streams.size) return
      const frame = `data: ${JSON.stringify({ event, payload })}\n\n`
      const output = event === 'terminal.data'
      const instance = output ? (payload as { instanceId?: string }).instanceId : undefined
      for (const [s, { terminal }] of streams) {
        // No filter: everything. ?terminal=none: everything but terminal output. ?terminal=<id>: that terminal's output only.
        const wanted = terminal === undefined || (terminal === 'none' ? !output : output && terminal === instance)
        if (wanted) s.write(frame)
      }
    },
    pushTokens: () => devices.pushTokens(),
    dropPushToken: (token) => devices.dropPushToken(token),
    close: () => {
      for (const s of streams.keys()) s.end()
      for (const server of listeners.values()) server.close()
      listeners.clear()
    }
  }
}
