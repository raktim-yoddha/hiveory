import { createHash, randomBytes, randomInt } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { toAppError, type Result } from '@shared/errors'
import { requestSchemas, type Channel } from '@shared/ipc/contract'
import { PAIRING_TTL_MS, REMOTE_CHANNELS, type ServerCall } from '@shared/ipc/remote'
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
}

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
  has(token: string): boolean {
    const wanted = hash(token)
    return this.devices.some((d) => d.tokenHash === wanted)
  }
  add(name: string): string {
    const token = randomBytes(32).toString('base64url')
    this.devices.push({ id: randomBytes(6).toString('hex'), name: name.slice(0, 80), tokenHash: hash(token), pairedAt: new Date().toISOString() })
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ devices: this.devices }, null, 2), { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
    return token
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
  broadcast(event: string, payload: unknown): void
  close(): void
}

/**
 * Hiveory as a server (ADR 0022): the whole app runs on this machine (a VM,
 * a box under the desk) and desktop clients use it over HTTP — calls as POST,
 * events as one Server-Sent Events stream. It binds to loopback by default, so
 * clients reach it through an SSH tunnel; pairing trades a short one-time code
 * for a device token. Every call is a REMOTE_CHANNELS channel and is validated
 * with the same schemas as local IPC.
 */
export const startServer = (options: { port: number; host: string; handlers: Handlers; log: Logger; devicesFile: string; version: string }): Promise<HiveoryServer> => {
  const { handlers, log } = options
  const devices = new DeviceStore(options.devicesFile)
  const streams = new Set<ServerResponse>()
  let code = ''
  let codeUntil = 0
  let failures: number[] = []
  const freshCode = (): string => {
    code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
    codeUntil = Date.now() + PAIRING_TTL_MS
    log.info(`Hiveory server pairing code: ${code} (valid 15 minutes, single use)`)
    return code
  }
  const currentCode = (): string => (Date.now() > codeUntil ? freshCode() : code)
  freshCode()

  const authorized = (req: IncomingMessage): boolean => {
    const header = req.headers.authorization ?? ''
    return header.startsWith('Bearer ') && devices.has(header.slice(7))
  }

  const call = async (body: ServerCall): Promise<Result<unknown>> => {
    const channel = body.channel as Channel
    if (!REMOTE_CHANNELS.has(channel)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Not available from a client.' } }
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

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://hiveory')
    void (async () => {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, app: 'hiveory', version: options.version })
      if (req.method === 'POST' && url.pathname === '/pair') {
        const now = Date.now()
        failures = failures.filter((t) => now - t < PAIR_WINDOW_MS)
        if (failures.length >= MAX_PAIR_FAILURES) return json(res, 429, { error: 'Too many wrong codes. Try again later.' })
        const body = (await readBody(req)) as { code?: unknown; name?: unknown }
        if (typeof body.code !== 'string' || body.code.toUpperCase() !== currentCode()) {
          failures.push(now)
          return json(res, 403, { error: 'That pairing code is wrong or has expired.' })
        }
        const token = devices.add(typeof body.name === 'string' ? body.name : 'Desktop')
        log.info('A device paired with this Hiveory server')
        freshCode()
        return json(res, 200, { token })
      }
      if (!authorized(req)) return json(res, 401, { error: 'Pair this device first.' })
      if (req.method === 'POST' && url.pathname === '/call') return json(res, 200, await call((await readBody(req)) as ServerCall))
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        res.write('retry: 2000\n\n')
        streams.add(res)
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
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      const port = (server.address() as { port: number }).port
      log.info(`Hiveory server listening on ${options.host}:${port}`)
      resolve({
        port,
        pairingCode: currentCode,
        broadcast: (event, payload) => {
          if (!streams.size) return
          const frame = `data: ${JSON.stringify({ event, payload })}\n\n`
          for (const s of streams) s.write(frame)
        },
        close: () => {
          for (const s of streams) s.end()
          server.close()
        }
      })
    })
  })
}
