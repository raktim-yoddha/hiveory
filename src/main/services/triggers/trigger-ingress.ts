import { createServer, type IncomingMessage, type Server } from 'node:http'

/** A delivery bigger than this is refused (Composio events are a few KB). */
export const MAX_BODY_BYTES = 256 * 1024
/** Deliveries one minute may bring before the rest are refused (a stuck or hostile sender). */
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000

export interface Delivery {
  headers: { id?: string; timestamp?: string; signature?: string }
  body: string
}

/**
 * The loopback listener trigger events arrive at (ADR 0028). Tailscale Funnel forwards one public
 * HTTPS path here; anything else (another path, another method, too big, too many) is refused before
 * it reaches the trigger service, which checks the signature.
 */
export class TriggerIngress {
  private server: Server | null = null
  private recent: number[] = []

  constructor(
    private readonly path: () => string,
    /** Handles a delivery: true when it was accepted (signed and known), false to answer 401. */
    private readonly onDelivery: (delivery: Delivery) => boolean
  ) {}

  /** The port it listens on (127.0.0.1 only), started on first use. */
  async port(): Promise<number> {
    if (this.server) return (this.server.address() as { port: number }).port
    const server = createServer((req, res) => {
      const answer = (status: number): void => {
        res.writeHead(status, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        res.end()
      }
      if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== this.path()) return answer(404)
      const now = Date.now()
      this.recent = this.recent.filter((t) => now - t < RATE_WINDOW_MS)
      if (this.recent.length >= RATE_LIMIT) return answer(429)
      this.recent.push(now)
      readBody(req).then(
        (body) => {
          const header = (name: string): string | undefined => {
            const value = req.headers[name]
            return Array.isArray(value) ? value[0] : value
          }
          let ok: boolean
          try {
            ok = this.onDelivery({ headers: { id: header('webhook-id'), timestamp: header('webhook-timestamp'), signature: header('webhook-signature') }, body })
          } catch {
            ok = false
          }
          answer(ok ? 200 : 401)
        },
        () => answer(413)
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    return (server.address() as { port: number }).port
  }

  close(): void {
    this.server?.close()
    this.server = null
  }
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
