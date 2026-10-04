import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Logger } from '../../../app/logger'
import type { HookEndpoint } from '../adapters/types'

const MAX_BODY = 1024 * 1024
const ROUTE = /^\/hooks\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,64})$/

export type HookHandler = (instanceId: string, event: string, payload: unknown) => void

/**
 * Loopback-only endpoint native CLI hooks report to (ADR 0006). Requests need
 * a per-run random token; responses are always empty so hook stdout never
 * feeds text back into an agent.
 */
export class HookServer {
  private server: Server | null = null
  private endpointValue: HookEndpoint | undefined
  private readonly token = randomBytes(24).toString('hex')

  constructor(
    private readonly onHook: HookHandler,
    private readonly log: Logger
  ) {}

  get endpoint(): HookEndpoint | undefined {
    return this.endpointValue
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      const done = (status: number): void => {
        res.writeHead(status).end()
      }
      const match = req.method === 'POST' ? ROUTE.exec(req.url ?? '') : null
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
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const { port } = server.address() as AddressInfo
    this.server = server
    this.endpointValue = { baseUrl: `http://127.0.0.1:${port}`, token: this.token }
    this.log.info(`Hook server listening on 127.0.0.1:${port}`)
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.endpointValue = undefined
  }

  private authorized(header: string | string[] | undefined): boolean {
    if (typeof header !== 'string') return false
    const a = Buffer.from(header)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }
}
