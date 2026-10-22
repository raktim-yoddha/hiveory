import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import type { CliStatus } from '@shared/domain/cli'
import type { Logger } from '../../app/logger'

/** One agent as Hiveory Pet sees it (ADR 0054): names and status only, never paths, terminal text or activity. */
export interface PetAgent {
  id: string
  name: string
  cli: string
  workspace: string
  worktree: string
  status: CliStatus
}

/** Changes arrive in bursts (a turn starting touches several agents); one frame per burst is enough. */
const SETTLE_MS = 150
const KEEPALIVE_MS = 25_000

/**
 * The link Hiveory Pet follows (ADR 0054), a separate app that shows every agent session on this computer.
 * Loopback only. The port and a random token go to `pet-link.json` in this user's Runtime folder: reading that
 * file is the pairing, so only this user's own apps get in. One read-only stream, `GET /pet/events`, sends the
 * running agents whenever they change. The file goes when the link stops.
 */
export class PetLink {
  private server: Server | null = null
  private readonly token = randomBytes(24).toString('hex')
  private readonly streams = new Set<ServerResponse>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly file: string,
    private readonly agents: () => PetAgent[],
    private readonly log: Logger,
    private readonly version: string
  ) {}

  get running(): boolean {
    return this.server !== null
  }

  async start(): Promise<void> {
    if (this.server) return
    const server = createServer((req, res) => {
      const auth = Buffer.from(req.headers.authorization ?? '')
      const want = Buffer.from(`Bearer ${this.token}`)
      if (auth.length !== want.length || !timingSafeEqual(auth, want)) return void res.writeHead(401).end()
      if (req.method !== 'GET' || req.url !== '/pet/events') return void res.writeHead(404).end()
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(this.frame())
      this.streams.add(res)
      const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS)
      req.on('close', () => {
        clearInterval(keepalive)
        this.streams.delete(res)
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    this.server = server
    const { port } = server.address() as AddressInfo
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ port, token: this.token, version: this.version }), { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
    this.log.info(`Pet link listening on 127.0.0.1:${port}`)
  }

  /** Agents changed: every open stream gets the new list, once things settle. */
  changed(): void {
    if (!this.server || !this.streams.size || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const frame = this.frame()
      for (const stream of this.streams) stream.write(frame)
    }, SETTLE_MS)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const stream of this.streams) stream.end()
    this.streams.clear()
    this.server?.close()
    this.server = null
    rmSync(this.file, { force: true })
  }

  private frame(): string {
    return `data: ${JSON.stringify({ agents: this.agents() })}\n\n`
  }
}
