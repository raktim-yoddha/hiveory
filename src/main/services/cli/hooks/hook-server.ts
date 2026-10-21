import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Logger } from '../../../app/logger'
import type { HookEndpoint } from '../adapters/types'

const MAX_BODY = 1024 * 1024
const ROUTE = /^\/hooks\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,64})$/

export type HookHandler = (instanceId: string, event: string, payload: unknown) => void
/** Handles one MCP POST body for an agent; resolves to the JSON reply, or null for "accepted, no reply". */
export type McpHandler = (instanceId: string, body: unknown) => Promise<unknown>

const MCP_ROUTE = /^\/mcp\/([A-Za-z0-9_-]{1,128})$/

interface Kept {
  port: number
  token: string
}

const readKept = (file: string): Kept | null => {
  try {
    const kept = JSON.parse(readFileSync(file, 'utf8')) as Partial<Kept>
    return Number.isInteger(kept.port) && typeof kept.token === 'string' && /^[0-9a-f]{48}$/.test(kept.token) ? (kept as Kept) : null
  } catch {
    return null
  }
}

const keep = (file: string, kept: Kept, log: Logger): void => {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(kept), { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  } catch (error) {
    log.warn('Could not keep the hook endpoint for the next start', error)
  }
}

/**
 * Loopback-only endpoint native CLI hooks report to (ADR 0006). Requests need
 * a random token; responses are always empty so hook stdout never feeds text
 * back into an agent. With `keepFile`, the port and token are kept across runs
 * (that file is this user's only): an agent that kept running while Hiveory was
 * closed (ADR 0050) still reaches it with the URL it was started with.
 */
export class HookServer {
  private server: Server | null = null
  private endpointValue: HookEndpoint | undefined
  private readonly token: string
  private readonly keptPort: number

  private onMcp: McpHandler | null = null

  constructor(
    private readonly onHook: HookHandler,
    private readonly log: Logger,
    private readonly keepFile?: string
  ) {
    const kept = keepFile ? readKept(keepFile) : null
    this.token = kept?.token ?? randomBytes(24).toString('hex')
    this.keptPort = kept?.port ?? 0
  }

  /** Enables the agent-tools MCP endpoint at /mcp/<instanceId>. */
  setMcpHandler(handler: McpHandler | null): void {
    this.onMcp = handler
  }

  get endpoint(): HookEndpoint | undefined {
    return this.endpointValue
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      const done = (status: number): void => {
        res.writeHead(status).end()
      }
      const url = (req.url ?? '').split('?')[0] ?? ''
      const mcp = MCP_ROUTE.exec(url)
      if (mcp) return this.handleMcp(req, res, mcp[1] as string)
      const match = req.method === 'POST' ? ROUTE.exec(url) : null
      if (!match) return done(404)
      if (!this.authorized(req.headers['x-hiveory-token'])) return done(403)

      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY) req.destroy()
        else chunks.push(chunk)
      })
      req.on('error', () => undefined)
      req.on('end', () => {
        done(204)
        let payload: unknown
        try {
          const text = Buffer.concat(chunks).toString('utf8').trim()
          payload = text ? JSON.parse(text) : null
        } catch {
          payload = null
        }
        try {
          this.onHook(match[1] as string, match[2] as string, payload)
        } catch (error) {
          this.log.warn('Hook handler failed', error)
        }
      })
    })
    server.on('error', (error) => this.log.error('Hook server error', error))
    const listen = (at: number): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(at, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
    // Last run's port when it is free; any free one when something else took it meanwhile.
    await listen(this.keptPort).catch((error: NodeJS.ErrnoException) => {
      if (!this.keptPort || error.code !== 'EADDRINUSE') throw error
      this.log.warn(`Hook port ${this.keptPort} is taken; agents kept from last time report through heuristics only.`)
      return listen(0)
    })
    const { port } = server.address() as AddressInfo
    if (this.keepFile) keep(this.keepFile, { port, token: this.token }, this.log)
    this.server = server
    this.endpointValue = { baseUrl: `http://127.0.0.1:${port}`, token: this.token }
    this.log.info(`Hook server listening on 127.0.0.1:${port}`)
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.endpointValue = undefined
  }

  private handleMcp(req: IncomingMessage, res: ServerResponse, instanceId: string): void {
    const reply = (status: number, body?: unknown, headers: Record<string, string> = {}): void => {
      if (body === undefined) res.writeHead(status, headers).end()
      else res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body))
    }
    // Browsers send Origin; MCP clients don't. Refusing it blocks DNS-rebinding style access from web pages.
    if (req.headers.origin) return reply(403)
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1]
    if (!this.authorized(bearer ?? req.headers['x-hiveory-token'])) return reply(401)
    if (!this.onMcp) return reply(503)
    if (req.method !== 'POST') return reply(405, undefined, { Allow: 'POST' })
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) req.destroy()
      else chunks.push(chunk)
    })
    req.on('error', () => undefined)
    req.on('end', () => {
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      }
      const handler = this.onMcp
      if (!handler) return reply(503)
      handler(instanceId, body)
        .then((result) => (result === null ? reply(202) : reply(200, result)))
        .catch((error) => {
          this.log.warn('MCP request failed', error)
          reply(500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } })
        })
    })
  }

  private authorized(header: string | string[] | undefined): boolean {
    if (typeof header !== 'string') return false
    const a = Buffer.from(header)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }
}
