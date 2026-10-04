import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import * as pty from '@lydell/node-pty'
import type { CliInstance, CliRuntimeDetails } from '@shared/domain'
import { fail } from '@shared/errors'
import type { Logger } from '../../../app/logger'
import type { HookEndpoint } from '../adapters/types'
import type { CliRegistry } from '../registry'
import { HeuristicDetector } from '../status/heuristics'
import { NOT_RUNNING, reduceStatus, sameDetails, type StatusEvent } from '../status/status-machine'
import { sanitizeEnv } from './env'
import { OutputBuffer } from './output-buffer'

interface PendingSpawn {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timer: NodeJS.Timeout
}

interface Session {
  instance: CliInstance
  process: pty.IPty | null
  /** Prepared launch waiting for the terminal's real size (see `launch`). */
  pending: PendingSpawn | null
  size: { cols: number; rows: number } | null
  buffer: OutputBuffer
  outbox: { data: string; offset: number } | null
  detector: HeuristicDetector | null
  details: CliRuntimeDetails
}

export interface RuntimeManagerEvents {
  data: [instanceId: string, data: string, offset: number]
  changed: [instance: CliInstance, details: CliRuntimeDetails]
}

/** Longest wait for a terminal size before spawning anyway (pane not visible). */
const SPAWN_FALLBACK_MS = 600
/** Output is coalesced per instance for this long, so one TUI frame is one IPC message. */
const FLUSH_MS = 4
const DEFAULT_SIZE = { cols: 120, rows: 32 }

const phaseOf = (d: CliRuntimeDetails): 'idle' | 'working' | 'waiting' =>
  d.status === 'waiting-for-you' ? 'waiting' : d.status

/**
 * Owns every CLI process (React never does — architecture.md). Generic over
 * providers: adapters supply launch arguments and status mapping.
 */
export class CliRuntimeManager extends EventEmitter<RuntimeManagerEvents> {
  private readonly sessions = new Map<string, Session>()
  private readonly ticker: NodeJS.Timeout

  constructor(
    private readonly registry: CliRegistry,
    private readonly log: Logger,
    private readonly runtimeRoot: string,
    private readonly hookEndpoint: () => HookEndpoint | undefined
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
  launch(instance: CliInstance, cwd: string): void {
    const existing = this.sessions.get(instance.id)
    if (existing?.process || existing?.pending) return
    const adapter = this.registry.adapter(instance.cliId)
    const executable = this.registry.executable(instance.cliId)
    if (!adapter || !executable) {
      const message = `${this.registry.displayName(instance.cliId)} is not installed or not on PATH.`
      this.markFailed(instance, message)
      fail('CLI_UNAVAILABLE', message, { hint: 'Install the CLI, then refresh the agent list.' })
    }
    const hook = adapter!.mapHookEvent ? this.hookEndpoint() : undefined
    const spec = adapter!.buildLaunch({
      instance,
      cwd,
      autoApprove: instance.autoApprove,
      hook,
      runtimeDir: join(this.runtimeRoot, instance.id)
    })

    const session = existing ?? this.createSession(instance)
    session.instance = instance
    const heuristics = adapter!.heuristics(Boolean(hook))
    session.detector = heuristics ? new HeuristicDetector(heuristics) : null
    this.sessions.set(instance.id, session)

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
    const [file, args] = this.resolveCommand(executable!, spec.args)
    if (existing) this.emitData(session, '\r\n\x1b[2m── session restarted ──\x1b[0m\r\n')
    session.pending = { file, args, cwd, env, timer: setTimeout(() => this.spawnNow(session), SPAWN_FALLBACK_MS) }
    this.apply(session, { type: 'started' }, 'process')
    if (session.size) this.spawnNow(session)
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
    if (session.pending) {
      clearTimeout(session.pending.timer)
      session.pending = null
    }
    const child = session.process
    session.process = null
    if (child) {
      // ConPTY teardown can take a moment; never block the IPC reply on it.
      setImmediate(() => {
        try {
          child.kill()
        } catch (error) {
          this.log.warn(`Failed to kill ${instanceId}`, error)
        }
      })
    }
    if (session.details.running) this.apply(session, { type: 'exited', code: 0 }, 'process')
  }

  /** Stops the process and forgets the session (agent closed). */
  dispose(instanceId: string): void {
    this.stop(instanceId)
    this.sessions.delete(instanceId)
  }

  disposeAll(): void {
    clearInterval(this.ticker)
    for (const session of this.sessions.values()) {
      if (session.pending) clearTimeout(session.pending.timer)
      try {
        session.process?.kill()
      } catch {
        // Quitting: nothing left to report to.
      }
    }
    this.sessions.clear()
  }

  write(instanceId: string, data: string): void {
    const session = this.sessions.get(instanceId)
    if (!session) return
    if (session.pending) this.spawnNow(session)
    if (!session.process) return
    session.process.write(data)
    const event = session.detector?.onInput(data, Date.now())
    if (event) this.apply(session, event, 'heuristic')
  }

  resize(instanceId: string, cols: number, rows: number): void {
    const session = this.sessions.get(instanceId)
    if (!session) return
    if (session.size?.cols === cols && session.size.rows === rows) return
    session.size = { cols, rows }
    if (session.pending) return this.spawnNow(session)
    try {
      session.process?.resize(cols, rows)
    } catch (error) {
      // Resizing a process that is exiting can throw; it is never fatal.
      this.log.warn(`Resize failed for ${instanceId}`, error)
    }
  }

  snapshot(instanceId: string): { data: string; end: number } {
    const session = this.sessions.get(instanceId)
    if (!session) return { data: '', end: 0 }
    this.flush(session)
    return session.buffer.snapshot()
  }

  details(instanceId: string): CliRuntimeDetails {
    return this.sessions.get(instanceId)?.details ?? NOT_RUNNING
  }

  /** Native hook callback from the hook server. Unknown instances are ignored. */
  ingestHook(instanceId: string, event: string, payload: unknown): void {
    const session = this.sessions.get(instanceId)
    if (!session?.process) return
    const adapter = this.registry.adapter(session.instance.cliId)
    let mapped: StatusEvent | null = null
    try {
      mapped = adapter?.mapHookEvent?.(event, payload) ?? null
    } catch (error) {
      this.log.warn(`Hook mapping failed for ${session.instance.cliId}/${event}`, error)
    }
    if (mapped) this.apply(session, mapped, 'hook')
  }

  private createSession(instance: CliInstance): Session {
    return {
      instance,
      process: null,
      pending: null,
      size: null,
      buffer: new OutputBuffer(),
      outbox: null,
      detector: null,
      details: NOT_RUNNING
    }
  }

  private spawnNow(session: Session): void {
    const pending = session.pending
    if (!pending) return
    clearTimeout(pending.timer)
    session.pending = null
    const { cols, rows } = session.size ?? DEFAULT_SIZE
    try {
      const child = pty.spawn(pending.file, pending.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: pending.cwd,
        env: pending.env,
        // Bundled modern ConPTY renders far more faithfully than the inbox Windows one.
        ...(process.platform === 'win32' ? { useConptyDll: true } : {})
      })
      session.process = child
      child.onData((data) => {
        this.emitData(session, data)
        const event = session.detector?.onOutput(data, Date.now())
        if (event) this.apply(session, event, 'heuristic')
      })
      child.onExit(({ exitCode, signal }) => {
        if (session.process !== child) return
        session.process = null
        this.flush(session)
        this.apply(session, { type: 'exited', code: exitCode, signal }, 'process')
      })
    } catch (error) {
      this.failSession(session, this.registry.displayName(session.instance.cliId), error)
    }
  }

  private failSession(session: Session, name: string, error: unknown): never {
    session.process = null
    if (session.pending) clearTimeout(session.pending.timer)
    session.pending = null
    const message = error instanceof Error ? error.message : String(error)
    this.apply(session, { type: 'failed', error: message }, 'process')
    return fail('CLI_LAUNCH_FAILED', `Could not start ${name}.`, { detail: message })
  }

  private resolveCommand(executable: string, args: string[]): [string, string[]] {
    const ext = extname(executable).toLowerCase()
    if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
      return [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', executable, ...args]]
    }
    return [executable, args]
  }

  private emitData(session: Session, data: string): void {
    const offset = session.buffer.append(data)
    if (session.outbox) {
      session.outbox.data += data
      return
    }
    session.outbox = { data, offset }
    setTimeout(() => this.flush(session), FLUSH_MS)
  }

  private flush(session: Session): void {
    const outbox = session.outbox
    if (!outbox) return
    session.outbox = null
    this.emit('data', session.instance.id, outbox.data, outbox.offset)
  }

  private apply(session: Session, event: StatusEvent, source: 'hook' | 'heuristic' | 'process'): void {
    const next = reduceStatus(session.details, event)
    if (source !== 'heuristic') session.detector?.sync(phaseOf(next))
    if (sameDetails(session.details, next)) return
    session.details = next
    this.emit('changed', session.instance, next)
  }

  private tick(): void {
    const now = Date.now()
    for (const session of this.sessions.values()) {
      if (!session.process) continue
      const event = session.detector?.tick(now)
      if (event) this.apply(session, event, 'heuristic')
    }
  }
}
