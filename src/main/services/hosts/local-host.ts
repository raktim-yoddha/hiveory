import { spawn } from 'node:child_process'
import { mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { HOST_PROTOCOL, type HostFrame, type HostTransport, type KeptHook, type TerminalHostStatus } from '@shared/host/protocol'
import { findExecutable } from '../cli/discovery'
import type { Logger } from '../../app/logger'
import type { HookEndpoint } from '../cli/adapters/types'
import { newNonce, prove, verifyProof } from './handshake'
import { HostClient } from './host-client'
import { lineTransport } from './line-transport'
import { pruneRuntimes, runtimeVersionOf, type DaemonRuntime } from './daemon-runtime'
import { localEndpointFile, otherProtocols, type LocalEndpoint } from './local-endpoint'

/** After this many failed starts in a row, PTYs stay in-process for the session. */
const MAX_FAILURES = 3
const HELLO_TIMEOUT_MS = 10_000
/** How long a freshly started daemon has to publish its endpoint. */
const DAEMON_START_MS = 10_000
/** A dropped daemon connection is retried this often before its terminals are given up. */
const RECONNECT_TRIES = 5
/** Live terminals no agent or shell took back after start-up are ended this long after it. */
const UNCLAIMED_MS = 2 * 60_000
/** How often an older daemon being drained is checked for terminals left (none: it is let go). */
const DRAIN_CHECK_MS = 30_000
/** Longest wait for this version's runtime copy before a daemon starts from the installed app. */
const STAGE_WAIT_MS = 60_000

const utilityTransport = (child: UtilityProcess): HostTransport => ({
  send: (frame) => child.postMessage(frame),
  onFrame: (listener) => void child.on('message', (frame: HostFrame) => listener(frame)),
  onClose: (listener) => void child.once('exit', () => listener()),
  close: () => void child.kill()
})

/** What the app does with what the daemon's relay receives (the same handlers as its own hook server). */
export interface RelayHandlers {
  hook(instanceId: string, event: string, payload: unknown): void
  mcp(instanceId: string, body: unknown): Promise<unknown>
}

/** A kept terminal handed back to its agent or shell, with the hooks its CLI reported meanwhile. */
export interface KeptTerminal {
  ptyId: string
  hooks: KeptHook[]
}

/**
 * How the daemon is started. On Linux, in its own `systemd-run --user --scope` when there is one, so
 * closing the desktop session's cgroup (the app's) never takes the terminals with it (ADR 0050 §10).
 */
export const daemonCommand = (
  exe: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  /** null: none (found on PATH by default). */
  systemdRun: string | null = platform === 'linux' && process.env.XDG_RUNTIME_DIR ? (findExecutable('systemd-run', { platform, path: process.env.PATH ?? '' }) ?? null) : null
): [string, string[]] => (platform === 'linux' && systemdRun ? [systemdRun, ['--user', '--scope', '--quiet', '--collect', '--', exe, ...args]] : [exe, args])

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
  /** Headless runs (chat turns, ADR 0051) the daemon held at start-up, by chat id, until their chat takes them. */
  private readonly runs = new Map<string, string>()
  /** Hooks the relay kept while Hiveory was closed, by agent. */
  private readonly keptHooks = new Map<string, KeptHook[]>()
  private relayValue: HookEndpoint | undefined
  private relayHandlers: RelayHandlers | null = null
  /** How long the daemon keeps terminals with no app attached (null: until they end). */
  private graceMs: number | null = null

  constructor(
    private readonly entry: string,
    /** The profile's own folder for the daemon: its endpoint.json and log. */
    private readonly dir: string,
    private readonly log: Logger,
    private readonly notice: (message: string) => void,
    /** False: never the durable daemon, only the utility process (automated runs leave nothing behind). */
    durable = true,
    /** This version's own runtime copy (installed builds, ADR 0050 §8); absent: run from the app. */
    private readonly runtime?: { version: string; stage: () => Promise<DaemonRuntime | null> }
  ) {
    if (!durable) this.mode = 'utility'
  }

  /** Older daemons (an earlier protocol) whose terminals this app took back and serves until they end. */
  private readonly drains = new Map<number, HostClient>()

  /** The daemon holding a kept terminal `take` named, and its own id there (ADR 0050 §8). */
  route(adopt: string): { client: HostClient; ptyId: string } | undefined {
    const [protocol, ptyId] = adopt.split('/')
    const client = ptyId ? this.drains.get(Number(protocol)) : undefined
    return client?.alive ? { client, ptyId: ptyId! } : undefined
  }

  /** Whether terminals started now outlive the app (the durable daemon serves them). */
  get durable(): boolean {
    return this.mode === 'daemon' && Boolean(this.client?.alive)
  }

  /**
   * The relay's URL and token while the durable daemon serves this app: agents launched with it
   * keep reporting hooks and reaching their tools across restarts (ADR 0050 §6).
   */
  get relayEndpoint(): HookEndpoint | undefined {
    return this.durable ? this.relayValue : undefined
  }

  /** Where this computer's terminals run now, for Settings › Agents › Terminal host. */
  async status(): Promise<TerminalHostStatus> {
    const client = this.client?.alive ? this.client : null
    if (this.mode === 'daemon' && client) {
      const endpoint = this.endpointOf(HOST_PROTOCOL)
      const terminals = (await client.call('pty.list', null).catch(() => [])).filter((t) => t.alive).length
      const runtime = runtimeVersionOf(this.dir, endpoint?.exe)
      return { mode: 'daemon', pid: endpoint?.pid, since: endpoint?.since, terminals, protocol: HOST_PROTOCOL, ...(runtime ? { runtime } : {}) }
    }
    if (client) return { mode: 'utility', terminals: client.terminalCount, protocol: HOST_PROTOCOL }
    return { mode: this.failures >= MAX_FAILURES ? 'in-process' : this.mode === 'daemon' ? 'daemon' : 'utility', terminals: 0, protocol: HOST_PROTOCOL }
  }

  /**
   * Settings › Agents › Restart terminal host: ends the daemon and every terminal it holds, so the
   * next terminal starts a fresh one (agents then resume their conversations).
   */
  async restart(): Promise<void> {
    const client = this.client
    this.client = null
    this.live.clear()
    this.keptHooks.clear()
    // While it shuts down, a dropped link is not a reconnect.
    this.closed = true
    if (client?.alive && this.mode === 'daemon') await client.call('shutdown', null, 3000).catch(() => undefined)
    client?.close()
    this.closed = false
    this.failures = 0
    if (this.mode === 'daemon') await this.get()
  }

  /** Settings › Agents › keep kept terminals for…: told to the daemon now and on every connect. */
  setGrace(ms: number | null): void {
    this.graceMs = ms
    if (this.mode === 'daemon') void this.client?.call('grace.set', { ms }).catch(() => undefined)
  }

  /** Where the relay's hooks and MCP requests go: set once, before `prepare`. */
  setRelayHandlers(handlers: RelayHandlers): void {
    this.relayHandlers = handlers
  }

  get(): Promise<HostClient | null> {
    if (this.client?.alive) return Promise.resolve(this.client)
    if (this.closed || this.failures >= MAX_FAILURES) return Promise.resolve(null)
    this.starting ??= this.start().finally(() => (this.starting = null))
    return this.starting
  }

  /**
   * At start-up: reaches the daemon that kept running since Hiveory last quit, or starts it, so
   * its relay exists before any agent launches. Notes its live terminals, so agents and shells take
   * them back instead of starting anew, and the hooks their CLIs reported meanwhile. Terminals for
   * keys Hiveory no longer knows are ended; ones that ended meanwhile are cleared.
   */
  async prepare(known: (key: string) => boolean): Promise<void> {
    if (this.mode !== 'daemon') return
    const client = (await this.connect().catch(() => null)) ?? (await this.startDaemon())
    if (!client) {
      this.mode = 'utility'
      this.notice('Agents will stop when Hiveory quits this time: the background terminal host could not start.')
      return
    }
    this.use(client)
    await this.collect(client, known, (ptyId) => ptyId, true)
    // A daemon from before an update to a new protocol: its terminals come back from it (ADR 0050 §8).
    for (const protocol of this.olderProtocols()) {
      const old = await this.connect(protocol).catch(() => null)
      if (!old) continue
      this.drain(protocol, old)
      await this.collect(old, known, (ptyId) => `${protocol}/${ptyId}`)
    }
    const running = runtimeVersionOf(this.dir, this.endpointOf(HOST_PROTOCOL)?.exe)
    if (this.runtime) pruneRuntimes(this.dir, [this.runtime.version, ...(running ? [running] : [])])
    if (this.live.size) this.log.info(`Terminal host kept ${this.live.size} terminal(s) while Hiveory was closed.`)
    setTimeout(() => {
      for (const ptyId of this.live.values()) void this.client?.call('pty.kill', { ptyId }).catch(() => undefined)
      this.live.clear()
      for (const procId of this.runs.values()) void this.client?.call('proc.kill', { procId }).catch(() => undefined)
      this.runs.clear()
    }, UNCLAIMED_MS).unref()
  }

  /** The daemon's live terminal for `key`, once (the caller attaches to it instead of spawning). */
  take(key: string): KeptTerminal | undefined {
    const ptyId = this.live.get(key)
    this.live.delete(key)
    const hooks = this.keptHooks.get(key) ?? []
    this.keptHooks.delete(key)
    return ptyId ? { ptyId, hooks } : undefined
  }

  /** Quitting with agents kept: the daemon keeps every terminal's output from here (call before saving it). */
  async hold(): Promise<void> {
    if (this.mode !== 'daemon') return
    await Promise.all([this.client, ...this.drains.values()].map((c) => c?.call('hold', null, 2000).catch(() => undefined)))
  }

  /** Quitting with agents kept: the connection closes, the daemon and its terminals carry on (a utility host ends). */
  detach(): void {
    this.closed = true
    this.client?.close()
    this.client = null
    for (const old of this.drains.values()) old.close()
    this.drains.clear()
  }

  /** Quitting with agents stopped: every terminal ends, and so does the daemon. */
  async shutdown(): Promise<void> {
    this.closed = true
    const client = this.client
    this.client = null
    if (client?.alive && this.mode === 'daemon') await client.call('shutdown', null, 3000).catch(() => undefined)
    client?.close()
    for (const old of this.drains.values()) {
      await old.call('shutdown', null, 3000).catch(() => undefined)
      old.close()
    }
    this.drains.clear()
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

  /** Notes a kept terminal per known key (`name` says how `take` will name it); ends the rest. */
  private async collect(client: HostClient, known: (key: string) => boolean, name: (ptyId: string) => string, takeRuns = false): Promise<void> {
    for (const hook of await client.call('relay.kept', null).catch(() => [])) {
      this.keptHooks.set(hook.instanceId, [...(this.keptHooks.get(hook.instanceId) ?? []), hook])
    }
    for (const t of await client.call('pty.list', null).catch(() => [])) {
      if (!t.alive) void client.call('pty.attach', { ptyId: t.ptyId }).catch(() => undefined)
      else if (t.key && known(t.key)) this.live.set(t.key, name(t.ptyId))
      else void client.call('pty.kill', { ptyId: t.ptyId }).catch(() => undefined)
    }
    // Chat turns: an ended one is taken too, so a reply finished while Hiveory was closed is kept whole.
    // Only this protocol's daemon: an older one's runs are left to end there.
    if (!takeRuns) return
    for (const r of await client.call('proc.list', null).catch(() => [])) {
      if (known(r.key)) this.runs.set(r.key, r.procId)
      else if (r.alive) void client.call('proc.kill', { procId: r.procId }).catch(() => undefined)
      else void client.call('proc.attach', { procId: r.procId }).catch(() => undefined)
    }
  }

  /** The daemon's run for a chat that outlived the last Hiveory, once (ADR 0051). */
  takeRun(chatId: string): string | undefined {
    const procId = this.runs.get(chatId)
    this.runs.delete(chatId)
    return procId
  }

  /** An older daemon: served for its kept terminals only (never a new one), let go once they end. */
  private drain(protocol: number, client: HostClient): void {
    this.drains.set(protocol, client)
    this.relay(client)
    const check = setInterval(() => {
      if (client.alive && client.terminalCount > 0) return
      clearInterval(check)
      this.drains.delete(protocol)
      client.close()
    }, DRAIN_CHECK_MS)
    check.unref()
    this.log.info(`Taking terminals back from an older terminal host (protocol ${protocol}).`)
  }

  private olderProtocols(): number[] {
    try {
      return otherProtocols(readdirSync(this.dir), HOST_PROTOCOL).filter((p) => p < HOST_PROTOCOL)
    } catch {
      return []
    }
  }

  private endpointOf(protocol: number): LocalEndpoint | null {
    try {
      return JSON.parse(readFileSync(join(this.dir, localEndpointFile(protocol)), 'utf8')) as LocalEndpoint
    } catch {
      return null
    }
  }

  /** Reaches the daemon its endpoint file names, and checks both sides hold its token (ADR 0050 §2). */
  private async connect(protocol = HOST_PROTOCOL): Promise<HostClient | null> {
    const endpoint = this.endpointOf(protocol)
    if (!endpoint || endpoint.protocol !== protocol || typeof endpoint.token !== 'string') return null
    if (protocol === HOST_PROTOCOL) this.relayValue = endpoint.relay
    const socket = await reach(endpoint.path)
    if (!socket) return null
    const client = new HostClient(lineTransport(socket, socket, () => socket.destroy()), { keepPtys: true })
    try {
      const nonce = newNonce()
      const hello = await client.call('hello', { protocol, nonce }, HELLO_TIMEOUT_MS)
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
    // From this version's own copy when there is one, so an update never ends it (ADR 0050 §8).
    const staged = this.runtime
      ? await Promise.race([this.runtime.stage().catch((error: unknown) => (this.log.warn('Could not copy the terminal host runtime', error), null)), delay(STAGE_WAIT_MS).then(() => null)])
      : null
    try {
      mkdirSync(this.dir, { recursive: true })
      const log = openSync(join(this.dir, 'daemon.log'), 'a')
      const [file, args] = daemonCommand(staged?.exe ?? process.execPath, [staged?.entry ?? this.entry, '--daemon', '--local', this.dir])
      spawn(file, args, {
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
    this.relay(client)
    client.onClosed(() => {
      if (this.client === client) this.client = null
      if (this.closed) return
      void this.reconnect(client)
    })
  }

  /** Hooks and tool calls from a daemon's relay go to the app's handlers; it is told the keep-for rule. */
  private relay(client: HostClient): void {
    void client.call('grace.set', { ms: this.graceMs }).catch(() => undefined)
    client.onRelay(
      ({ instanceId, event, payload }) => this.relayHandlers?.hook(instanceId, event, payload),
      ({ requestId, instanceId, body }) => {
        const answer = this.relayHandlers?.mcp(instanceId, body) ?? Promise.resolve(null)
        void answer
          .catch(() => ({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }))
          .then((reply) => client.notify('relay.reply', { requestId, body: reply }))
      }
    )
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
