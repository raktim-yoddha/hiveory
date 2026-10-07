import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import type { CliInstance, CliRuntimeDetails } from '@shared/domain'
import { fail } from '@shared/errors'
import type { Logger } from '../../../app/logger'
import { sanitizeEnv } from '../../pty/env'
import { PtySession } from '../../pty/pty-session'
import { inProcessPty, type PtyBackend } from '../../pty/pty-backend'
import type { HookEndpoint, McpEndpoint } from '../adapters/types'
import type { CliRegistry } from '../registry'
import type { HostKit } from '../../hosts/host-kit'
import { HeuristicDetector } from '../status/heuristics'
import { NOT_RUNNING, reduceStatus, sameDetails, type StatusEvent } from '../status/status-machine'

interface Session {
  instance: CliInstance
  pty: PtySession
  detector: HeuristicDetector | null
  details: CliRuntimeDetails
  /** Last model seen in its session (ModelTracker); carried across status changes. */
  model?: string
}

export interface RuntimeManagerEvents {
  data: [instanceId: string, data: string, offset: number]
  changed: [instance: CliInstance, details: CliRuntimeDetails]
  /** The CLI reported its own session id (stored so the agent resumes exactly that session). */
  session: [instance: CliInstance, sessionId: string]
}

export interface LaunchOptions {
  /** The only agent of its CLI in the folder (see `LaunchContext.soleOfCli`). */
  soleOfCli?: boolean
  /** The machine the agent runs on when it is not this computer (ADR 0022); connected on demand. */
  host?: Promise<HostKit>
}

const phaseOf = (d: CliRuntimeDetails): 'idle' | 'working' | 'waiting' =>
  d.status === 'waiting-for-you' ? 'waiting' : d.status

/** Resolves .cmd/.bat shims through cmd.exe on Windows; everything else spawns directly. */
export const resolveCommand = (executable: string, args: string[]): [string, string[]] => {
  const ext = extname(executable).toLowerCase()
  if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    return [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', executable, ...args]]
  }
  return [executable, args]
}

/**
 * Owns every CLI process (React never does — architecture.md). Generic over
 * providers: adapters supply launch arguments and status mapping; PtySession
 * supplies the terminal plumbing.
 */
export class CliRuntimeManager extends EventEmitter<RuntimeManagerEvents> {
  private readonly sessions = new Map<string, Session>()
  private readonly ticker: NodeJS.Timeout

  constructor(
    private readonly registry: CliRegistry,
    private readonly log: Logger,
    private readonly runtimeRoot: string,
    private readonly hookEndpoint: () => HookEndpoint | undefined,
    /** Hiveory's MCP endpoint for an agent; `baseUrl` replaces the local one for agents on another machine. */
    private readonly mcpEndpoint: (instanceId: string, baseUrl?: string) => McpEndpoint | undefined = () => undefined,
    /** Where agent PTYs run: the local host daemon in the app (ADR 0022). */
    private readonly ptyBackend: PtyBackend = inProcessPty
  ) {
    super()
    this.ticker = setInterval(() => this.tick(), 1000)
    this.ticker.unref()
  }

  /**
   * Prepares a launch and returns immediately. The process is spawned once the
   * renderer reports the pane's real terminal size, so a TUI never draws its
   * first frame at the wrong width (the cause of misaligned output).
   */
  launch(instance: CliInstance, cwd: string, options: LaunchOptions = {}): void {
    if (this.sessions.get(instance.id)?.pty.running) return
    if (!options.host) return this.launchOn(instance, cwd, options)
    // Another machine: connect (installing hiveoryd if needed), then start there. A host
    // that cannot be reached fails only this agent, with the reason in its pane.
    options.host.then(
      (kit) => {
        try {
          this.launchOn(instance, cwd, options, kit)
        } catch (error) {
          this.markFailed(instance, error instanceof Error ? error.message : String(error))
        }
      },
      (error: unknown) => this.markFailed(instance, error instanceof Error ? error.message : String(error))
    )
  }

  private launchOn(instance: CliInstance, cwd: string, options: LaunchOptions, kit?: HostKit): void {
    const existing = this.sessions.get(instance.id)
    if (existing?.pty.running) return
    const registry = kit?.registry ?? this.registry
    const adapter = registry.adapter(instance.cliId)
    const executable = registry.executable(instance.cliId)
    if (!adapter || !executable) {
      const where = kit?.remote ? ` on ${kit.label}` : ''
      const message = `${registry.displayName(instance.cliId)} is not installed${where} or not on PATH.`
      this.markFailed(instance, message)
      fail('CLI_UNAVAILABLE', message, { hint: 'Install the CLI, then refresh the agent list.' })
    }
    const hook = adapter!.mapHookEvent ? (kit ? kit.hook() : this.hookEndpoint()) : undefined
    const spec = adapter!.buildLaunch({
      instance,
      cwd,
      autoApprove: instance.autoApprove,
      hook,
      mcp: adapter!.injectMcp ? this.mcpEndpoint(instance.id, kit?.remote ? kit.hook()?.baseUrl : undefined) : undefined,
      runtimeDir: kit ? kit.paths.join(kit.runtimeRoot, instance.id) : join(this.runtimeRoot, instance.id),
      resume: instance.hasConversation,
      soleOfCli: options.soleOfCli ?? false
    })

    const session = existing ?? this.createSession(instance, kit?.pty)
    if (kit) session.pty.useBackend(kit.pty)
    session.instance = instance
    const heuristics = adapter!.heuristics(Boolean(hook))
    session.detector = heuristics ? new HeuristicDetector(heuristics) : null
    this.sessions.set(instance.id, session)
    if (existing) session.pty.annotate('\r\n\x1b[2m── session restarted ──\x1b[0m\r\n')

    if (kit?.remote) {
      // The remote machine's own environment, never this computer's (no Windows PATH on a Linux box).
      const env: Record<string, string> = { TERM: 'xterm-256color', COLORTERM: 'truecolor', HIVEORY_INSTANCE_ID: instance.id }
      for (const [k, v] of Object.entries(spec.env ?? {})) if (v !== undefined) env[k] = v
      const files = spec.files ?? []
      Promise.all(files.map((f) => kit.fs.writeText(f.path, f.content))).then(
        () => session.pty.start({ file: executable!, args: spec.args, cwd, env, inheritEnv: true }),
        (error: unknown) => this.markFailed(instance, `Could not prepare ${adapter!.displayName} on ${kit.label}: ${error instanceof Error ? error.message : String(error)}`)
      )
      this.apply(session, { type: 'started' }, 'process')
      return
    }

    try {
      for (const file of spec.files ?? []) {
        mkdirSync(dirname(file.path), { recursive: true })
        writeFileSync(file.path, file.content, 'utf8')
      }
    } catch (error) {
      this.failSession(session, adapter!.displayName, error)
    }
    const env = sanitizeEnv(process.env, spec.env)
    env.HIVEORY_INSTANCE_ID = instance.id
    const [file, args] = resolveCommand(executable!, spec.args)
    session.pty.start({ file, args, cwd, env })
    this.apply(session, { type: 'started' }, 'process')
  }

  /** Records a launch failure that happened before a process existed. */
  markFailed(instance: CliInstance, error: string): void {
    const session = this.sessions.get(instance.id) ?? this.createSession(instance)
    this.sessions.set(instance.id, session)
    this.apply(session, { type: 'failed', error }, 'process')
  }

  stop(instanceId: string): void {
    const session = this.sessions.get(instanceId)
    if (!session) return
    session.pty.stop()
    if (session.details.running) this.apply(session, { type: 'exited', code: 0 }, 'process')
  }

  /** Stops the process and forgets the session (agent closed). */
  dispose(instanceId: string): void {
    const session = this.sessions.get(instanceId)
    this.stop(instanceId)
    session?.pty.removeAllListeners()
    this.sessions.delete(instanceId)
  }

  disposeAll(): void {
    clearInterval(this.ticker)
    for (const session of this.sessions.values()) session.pty.killNow()
    this.sessions.clear()
  }

  has(instanceId: string): boolean {
    return this.sessions.has(instanceId)
  }

  write(instanceId: string, data: string): void {
    const session = this.sessions.get(instanceId)
    if (!session?.pty.running) return
    session.pty.write(data)
    const event = session.detector?.onInput(data, Date.now())
    if (event) this.apply(session, event, 'heuristic')
  }

  resize(instanceId: string, cols: number, rows: number): void {
    this.sessions.get(instanceId)?.pty.resize(cols, rows)
  }

  snapshot(instanceId: string): { data: string; end: number; cols?: number; rows?: number } {
    return this.sessions.get(instanceId)?.pty.snapshot() ?? { data: '', end: 0 }
  }

  /** Rendered screen text of an agent (agent tools: read another agent). */
  screenText(instanceId: string, lines: number): string {
    return this.sessions.get(instanceId)?.pty.screenText(lines) ?? ''
  }

  bracketedPaste(instanceId: string): boolean {
    return Boolean(this.sessions.get(instanceId)?.pty.bracketedPaste)
  }

  /** The model an agent is using now (from ModelTracker). Changes show on its Kanban card. */
  setModel(instanceId: string, model: string): void {
    const session = this.sessions.get(instanceId)
    if (!session || session.model === model) return
    session.model = model
    session.details = { ...session.details, model }
    this.emit('changed', session.instance, session.details)
  }

  details(instanceId: string): CliRuntimeDetails {
    return this.sessions.get(instanceId)?.details ?? NOT_RUNNING
  }

  /** Native hook callback from the hook server. Unknown instances are ignored. */
  ingestHook(instanceId: string, event: string, payload: unknown): void {
    const session = this.sessions.get(instanceId)
    if (!session?.pty.hasProcess) return
    const adapter = this.registry.adapter(session.instance.cliId)
    let mapped: StatusEvent | null = null
    try {
      mapped = adapter?.mapHookEvent?.(event, payload) ?? null
    } catch (error) {
      this.log.warn(`Hook mapping failed for ${session.instance.cliId}/${event}`, error)
    }
    if (mapped) this.apply(session, mapped, 'hook')
    try {
      const sessionId = adapter?.sessionIdFromHook?.(event, payload)
      if (sessionId && sessionId !== session.instance.providerSessionId) this.emit('session', session.instance, sessionId)
    } catch (error) {
      this.log.warn(`Session id extraction failed for ${session.instance.cliId}`, error)
    }
  }

  private createSession(instance: CliInstance, backend: PtyBackend = this.ptyBackend): Session {
    const session: Session = { instance, pty: new PtySession(true, backend), detector: null, details: NOT_RUNNING }
    session.pty.on('data', (data, offset) => this.emit('data', session.instance.id, data, offset))
    session.pty.on('raw', (data) => {
      const event = session.detector?.onOutput(data, Date.now())
      if (event) this.apply(session, event, 'heuristic')
    })
    session.pty.on('exit', (code, signal) => this.apply(session, { type: 'exited', code, signal }, 'process'))
    session.pty.on('error', (error) => {
      this.log.warn(`Spawn failed for ${session.instance.cliId}`, error)
      this.apply(session, { type: 'failed', error: error.message }, 'process')
    })
    return session
  }

  private failSession(session: Session, name: string, error: unknown): never {
    session.pty.stop()
    const message = error instanceof Error ? error.message : String(error)
    this.apply(session, { type: 'failed', error: message }, 'process')
    return fail('CLI_LAUNCH_FAILED', `Could not start ${name}.`, { detail: message })
  }

  private apply(session: Session, event: StatusEvent, source: 'hook' | 'heuristic' | 'process'): void {
    const reduced = reduceStatus(session.details, event)
    const next = session.model ? { ...reduced, model: session.model } : reduced
    if (source !== 'heuristic') session.detector?.sync(phaseOf(next))
    if (sameDetails(session.details, next)) return
    session.details = next
    this.emit('changed', session.instance, next)
  }

  private tick(): void {
    const now = Date.now()
    for (const session of this.sessions.values()) {
      if (!session.pty.hasProcess) continue
      const event = session.detector?.tick(now)
      if (event) this.apply(session, event, 'heuristic')
    }
  }
}
