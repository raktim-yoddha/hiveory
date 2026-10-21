import { spawn } from 'node:child_process'
import { mkdirSync, openSync, readFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { HOST_PROTOCOL, type HostFrame, type HostTransport } from '@shared/host/protocol'
import type { Logger } from '../../app/logger'
import { newNonce, prove, verifyProof } from './handshake'
import { HostClient } from './host-client'
import { lineTransport } from './line-transport'
import { LOCAL_ENDPOINT_FILE, type LocalEndpoint } from './local-endpoint'

/** After this many failed starts in a row, PTYs stay in-process for the session. */
const MAX_FAILURES = 3
const HELLO_TIMEOUT_MS = 10_000
/** How long a freshly started daemon has to publish its endpoint. */
const DAEMON_START_MS = 10_000
/** A dropped daemon connection is retried this often before its terminals are given up. */
const RECONNECT_TRIES = 5
/** Live terminals no agent or shell took back after start-up are ended this long after it. */
const UNCLAIMED_MS = 2 * 60_000

const utilityTransport = (child: UtilityProcess): HostTransport => ({
  send: (frame) => child.postMessage(frame),
  onFrame: (listener) => void child.on('message', (frame: HostFrame) => listener(frame)),
  onClose: (listener) => void child.once('exit', () => listener()),
  close: () => void child.kill()
})

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const reach = (path: string): Promise<Socket | null> =>
  new Promise((resolve) => {
    const socket = connect(path)
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(null)
    }, 2000)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })

/**
 * This computer's host daemon (hiveoryd, ADR 0022, 0050). Preferably the durable one: a detached
 * process on a private endpoint that outlives Hiveory, so quitting or updating never ends an agent,
 * and the next start takes its terminals back (`prepare`, `take`). If that cannot start, a utility
 * process (isolated, not durable); if that keeps failing, `get()` answers null and PTYs run
 * in-process. Each step down is announced: terminals never stop working.
 */
export class LocalHost {
  private client: HostClient | null = null
  private starting: Promise<HostClient | null> | null = null
  private mode: 'daemon' | 'utility' = 'daemon'
  private failures = 0
  private closed = false
  /** Live terminals the daemon held at start-up, by key, until their agent or shell takes them. */
  private readonly live = new Map<string, string>()

  constructor(
    private readonly entry: string,
    /** The profile's own folder for the daemon: its endpoint.json and log. */
    private readonly dir: string,
    private readonly log: Logger,
    private readonly notice: (message: string) => void,
    /** False: never the durable daemon, only the utility process (automated runs leave nothing behind). */
    durable = true
  ) {
    if (!durable) this.mode = 'utility'
  }

  /** Whether terminals started now outlive the app (the durable daemon serves them). */
  get durable(): boolean {
    return this.mode === 'daemon' && Boolean(this.client?.alive)
  }

  get(): Promise<HostClient | null> {
    if (this.client?.alive) return Promise.resolve(this.client)
    if (this.closed || this.failures >= MAX_FAILURES) return Promise.resolve(null)
    this.starting ??= this.start().finally(() => (this.starting = null))
    return this.starting
  }

  /**
   * At start-up: reaches a daemon that kept running since Hiveory last quit (never starts one) and
   * notes its live terminals, so agents and shells take them back instead of starting anew.
   * Terminals for keys Hiveory no longer knows are ended; ones that ended meanwhile are cleared.
   */
  async prepare(known: (key: string) => boolean): Promise<void> {
    const client = await this.connect().catch(() => null)
    if (!client) return
    this.use(client)
    const terminals = await client.call('pty.list', null).catch(() => [])
    for (const t of terminals) {
      if (!t.alive) void client.call('pty.attach', { ptyId: t.ptyId }).catch(() => undefined)
      else if (t.key && known(t.key)) this.live.set(t.key, t.ptyId)
      else void client.call('pty.kill', { ptyId: t.ptyId }).catch(() => undefined)
    }
    if (this.live.size) this.log.info(`Terminal host kept ${this.live.size} terminal(s) while Hiveory was closed.`)
    setTimeout(() => {
      for (const ptyId of this.live.values()) void this.client?.call('pty.kill', { ptyId }).catch(() => undefined)
      this.live.clear()
    }, UNCLAIMED_MS).unref()
  }

  /** The daemon's live terminal for `key`, once (the caller attaches to it instead of spawning). */
  take(key: string): string | undefined {
    const ptyId = this.live.get(key)
    this.live.delete(key)
    return ptyId
  }

  /** Quitting with agents kept: the daemon keeps every terminal's output from here (call before saving it). */
  async hold(): Promise<void> {
    if (this.mode === 'daemon') await this.client?.call('hold', null, 2000).catch(() => undefined)
  }

  /** Quitting with agents kept: the connection closes, the daemon and its terminals carry on (a utility host ends). */
  detach(): void {
    this.closed = true
    this.client?.close()
    this.client = null
  }

  /** Quitting with agents stopped: every terminal ends, and so does the daemon. */
  async shutdown(): Promise<void> {
    this.closed = true
    const client = this.client
    this.client = null
    if (client?.alive && this.mode === 'daemon') await client.call('shutdown', null, 3000).catch(() => undefined)
    client?.close()
  }

  private async start(): Promise<HostClient | null> {
    if (this.mode === 'daemon') {
      const client = (await this.connect().catch(() => null)) ?? (await this.startDaemon())
      if (client) {
        this.use(client)
        return client
      }
      this.mode = 'utility'
      this.notice('Agents will stop when Hiveory quits this time: the background terminal host could not start.')
    }
    return this.startUtility()
  }

  /** Reaches the daemon that endpoint.json names, and checks both sides hold its token (ADR 0050 §2). */
  private async connect(): Promise<HostClient | null> {
    let endpoint: LocalEndpoint
    try {
      endpoint = JSON.parse(readFileSync(join(this.dir, LOCAL_ENDPOINT_FILE), 'utf8')) as LocalEndpoint
    } catch {
      return null
    }
    if (endpoint.protocol !== HOST_PROTOCOL || typeof endpoint.token !== 'string') return null
    const socket = await reach(endpoint.path)
    if (!socket) return null
    const client = new HostClient(lineTransport(socket, socket, () => socket.destroy()), { keepPtys: true })
    try {
      const nonce = newNonce()
      const hello = await client.call('hello', { protocol: HOST_PROTOCOL, nonce }, HELLO_TIMEOUT_MS)
      if (!verifyProof(endpoint.token, 'daemon', nonce, hello.proof) || !hello.nonce) {
        this.log.error('Something answered on the terminal host endpoint without its token; not using it.')
        throw new Error('The terminal host endpoint did not prove its token.')
      }
      await client.call('auth', { proof: prove(endpoint.token, 'client', hello.nonce) }, HELLO_TIMEOUT_MS)
      return client
    } catch (error) {
      client.close()
      throw error
    }
  }

  /** Starts the daemon detached, so it outlives this process, and waits for it to answer. */
  private async startDaemon(): Promise<HostClient | null> {
    try {
      mkdirSync(this.dir, { recursive: true })
      const log = openSync(join(this.dir, 'daemon.log'), 'a')
      spawn(process.execPath, [this.entry, '--daemon', '--local', this.dir], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log, log],
        cwd: this.dir
      }).unref()
    } catch (error) {
      this.log.error('Terminal host daemon could not start', error)
      return null
    }
    const until = Date.now() + DAEMON_START_MS
    while (Date.now() < until) {
      await delay(150)
      const client = await this.connect().catch(() => null)
      if (client) {
        this.log.info('Terminal host daemon started')
        return client
      }
    }
    this.log.error('Terminal host daemon did not answer in time (see daemon.log in its folder)')
    return null
  }

  /** Makes `client` the daemon connection; a drop is retried, and only then are its terminals given up. */
  private use(client: HostClient): void {
    this.failures = 0
    this.client = client
    client.onClosed(() => {
      if (this.client === client) this.client = null
      if (this.closed) return
      void this.reconnect(client)
    })
  }

  private async reconnect(lost: HostClient): Promise<void> {
    for (let i = 0; i < RECONNECT_TRIES && !this.closed; i++) {
      await delay(500 * (i + 1))
      const next = await this.connect().catch(() => null)
      if (!next) continue
      this.use(next)
      await next.adopt(lost)
      this.log.info('Reconnected to the terminal host; its terminals carried on.')
      return
    }
    lost.abandon()
    if (this.closed) return
    this.log.warn('The terminal host stopped; it restarts with the next terminal.')
    this.notice('The terminal host stopped, so its agents and terminals ended. Restart them; Hiveory kept running.')
  }

  private async startUtility(): Promise<HostClient | null> {
    let child: UtilityProcess
    try {
      child = utilityProcess.fork(this.entry, [], { serviceName: 'Hiveory host', stdio: 'pipe' })
    } catch (error) {
      return this.failed('could not start', error)
    }
    child.stdout?.on('data', (d: Buffer) => this.log.info(`hiveoryd: ${String(d).trim()}`))
    child.stderr?.on('data', (d: Buffer) => this.log.warn(`hiveoryd: ${String(d).trim()}`))
    const client = new HostClient(utilityTransport(child))
    try {
      const hello = await client.call('hello', { protocol: HOST_PROTOCOL }, HELLO_TIMEOUT_MS)
      if (hello.protocol !== HOST_PROTOCOL) throw new Error(`protocol ${hello.protocol}, expected ${HOST_PROTOCOL}`)
    } catch (error) {
      client.close()
      return this.failed('did not answer', error)
    }
    this.failures = 0
    this.client = client
    client.onClosed(() => {
      if (this.client === client) this.client = null
      if (this.closed) return
      this.failures++
      this.log.warn('The terminal host stopped; it restarts with the next terminal.')
      this.notice('The terminal host stopped, so its agents and terminals ended. Restart them; Hiveory kept running.')
    })
    this.log.info(`Terminal host started (pid ${child.pid})`)
    return client
  }

  private failed(what: string, error: unknown): null {
    this.failures++
    this.log.error(`Terminal host ${what}`, error)
    if (this.failures >= MAX_FAILURES) this.notice('Terminals now run inside Hiveory: the separate terminal host could not start.')
    return null
  }
}
