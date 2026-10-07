import { AppException } from '@shared/errors'
import type { HostCall, HostCalls, HostEvents, HostFailure, HostFrame, HostNotifications, HostService, HostTransport, PtySpawnParams } from '@shared/host/protocol'
import { GitCommandError } from '../git/git-service'
import type { PtyBackend, PtyHandle } from '../pty/pty-backend'

const CALL_TIMEOUT_MS = 30_000

type ExitListener = (exit: { exitCode: number | null; signal: number | null }) => void

interface PtyListeners {
  data: (d: string) => void
  exit: ExitListener
  /** The terminal now lives on another client (after a reconnect). */
  moved?: (client: HostClient) => void
}

/**
 * The client side of the execution-host protocol (ADR 0022): calls with
 * timeouts, fire-and-forget notifications, and PTY events routed to their
 * handles. When the transport closes, every pending call fails and every PTY
 * it served reports an exit, so nothing waits forever on a dead host.
 */
export class HostClient {
  private seq = 0
  private readonly calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private readonly ptys = new Map<string, PtyListeners>()
  private readonly closeListeners: Array<() => void> = []
  private readonly fileListeners: Array<(e: HostEvents['files.changed']) => void> = []
  private closed = false

  constructor(
    private readonly transport: HostTransport,
    /** A remote daemon keeps its terminals when the link drops (ADR 0025): they wait for `adopt` instead of exiting. */
    private readonly options: { keepPtys?: boolean } = {}
  ) {
    transport.onFrame((frame) => this.onFrame(frame))
    transport.onClose(() => this.onClose())
  }

  get alive(): boolean {
    return !this.closed
  }

  call<M extends HostCall>(method: M, params: HostCalls[M]['params'], timeoutMs = CALL_TIMEOUT_MS): Promise<HostCalls[M]['result']> {
    if (this.closed) return Promise.reject(new Error('The host is not connected.'))
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id)
        reject(new Error(`The host did not answer ${method} in time.`))
      }, timeoutMs)
      this.calls.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.transport.send({ kind: 'call', id, method, params })
    })
  }

  notify<N extends keyof HostNotifications>(method: N, params: HostNotifications[N]): void {
    if (!this.closed) this.transport.send({ kind: 'notify', method, params })
  }

  bind(ptyId: string, listeners: PtyListeners): void {
    this.ptys.set(ptyId, listeners)
  }

  /**
   * Takes over the terminals of a client whose link dropped (ADR 0025): each one the
   * daemon still runs continues here with the output it produced meanwhile; one that
   * ended meanwhile reports its exit.
   */
  async adopt(from: HostClient): Promise<void> {
    const moving = [...from.ptys]
    from.ptys.clear()
    for (const [ptyId, listeners] of moving) {
      const result = await this.call('pty.attach', { ptyId }).catch(() => ({ alive: false as const, code: null, signal: null }))
      if (!result.alive) {
        listeners.exit({ exitCode: result.code, signal: result.signal })
        continue
      }
      this.ptys.set(ptyId, listeners)
      listeners.moved?.(this)
      if (result.data) listeners.data(result.data)
    }
  }

  /** Gives up on kept terminals (the host stayed unreachable): their panes say they ended. */
  abandon(): void {
    for (const pty of this.ptys.values()) pty.exit({ exitCode: null, signal: null })
    this.ptys.clear()
  }

  onClosed(listener: () => void): void {
    this.closeListeners.push(listener)
  }

  onFilesChanged(listener: (e: HostEvents['files.changed']) => void): void {
    this.fileListeners.push(listener)
  }

  /**
   * A service object whose methods run on the host (git, worktrees, files, fs), with the
   * same signatures as the local classes — so a service can be local or remote without
   * knowing which. Every method becomes async.
   */
  service<T extends object>(service: HostService): T {
    return new Proxy({} as T, {
      get: (_target, method) =>
        typeof method === 'string' && method !== 'then' ? (...args: unknown[]) => this.call('invoke', { service, method, args }, 120_000) : undefined
    })
  }

  close(): void {
    this.transport.close()
  }

  private onFrame(frame: HostFrame): void {
    if (frame.kind === 'result') {
      const call = this.calls.get(frame.id)
      if (!call) return
      this.calls.delete(frame.id)
      clearTimeout(call.timer)
      if (frame.ok) call.resolve(frame.value)
      else call.reject(rebuild(frame.failure ?? { message: frame.error }))
    } else if (frame.kind === 'event' && frame.event === 'files.changed') {
      for (const l of this.fileListeners) l(frame.params as HostEvents['files.changed'])
    } else if (frame.kind === 'event') {
      const p = frame.params as { ptyId: string; data?: string; code?: number | null; signal?: number | null }
      const target = this.ptys.get(p.ptyId)
      if (!target) return
      if (frame.event === 'pty.data') target.data(p.data ?? '')
      else if (frame.event === 'pty.exit') {
        this.ptys.delete(p.ptyId)
        target.exit({ exitCode: p.code ?? null, signal: p.signal ?? null })
      }
    }
  }

  private onClose(): void {
    if (this.closed) return
    this.closed = true
    for (const call of this.calls.values()) {
      clearTimeout(call.timer)
      call.reject(new Error('The host disconnected.'))
    }
    this.calls.clear()
    // A local host takes its PTYs with it; the processes are gone, so their panes say so.
    // A remote daemon keeps them for a while: they wait to be adopted by the next connection.
    if (!this.options.keepPtys) this.abandon()
    for (const l of this.closeListeners) l()
  }
}

/** The error the host threw, rebuilt with its type (AppException, GitCommandError) so callers' checks still work. */
const rebuild = (failure: HostFailure): Error =>
  failure.app
    ? new AppException(failure.app)
    : failure.git
      ? new GitCommandError(failure.git.args, failure.git.stderr, failure.git.exitCode)
      : new Error(failure.message)

/**
 * A PtyHandle that exists at once and starts its process as soon as the host is
 * ready: on the host daemon when there is one, otherwise with `fallback` in this
 * process — terminals always work, isolated whenever possible.
 */
class HostedPty implements PtyHandle {
  private readonly dataListeners: Array<(d: string) => void> = []
  private readonly exitListeners: ExitListener[] = []
  private readonly errorListeners: Array<(e: Error) => void> = []
  private target: { write(d: string): void; resize(c: number, r: number): void; kill(): void } | null = null
  private queued: string[] = []
  private size: { cols: number; rows: number } | null = null
  private killed = false

  constructor(spec: PtySpawnParams, host: Promise<HostClient | null>, fallback: PtyBackend) {
    void host.then(
      (client) => (client?.alive ? this.startRemote(client, spec) : this.startLocal(spec, fallback)),
      () => this.startLocal(spec, fallback)
    )
  }

  onData(l: (d: string) => void): void {
    this.dataListeners.push(l)
  }
  onExit(l: ExitListener): void {
    this.exitListeners.push(l)
  }
  onError(l: (e: Error) => void): void {
    this.errorListeners.push(l)
  }

  write(data: string): void {
    if (this.target) this.target.write(data)
    else this.queued.push(data)
  }

  resize(cols: number, rows: number): void {
    this.size = { cols, rows }
    this.target?.resize(cols, rows)
  }

  kill(): void {
    this.killed = true
    this.target?.kill()
  }

  private ready(target: NonNullable<HostedPty['target']>, spec: PtySpawnParams): void {
    this.target = target
    if (this.killed) return target.kill()
    for (const data of this.queued) target.write(data)
    this.queued = []
    if (this.size && (this.size.cols !== spec.cols || this.size.rows !== spec.rows)) target.resize(this.size.cols, this.size.rows)
  }

  private startRemote(client: HostClient, spec: PtySpawnParams): void {
    const at = this.size ?? { cols: spec.cols, rows: spec.rows }
    // The client this terminal talks through; a reconnect moves it to the new one.
    let live = client
    client.call('pty.spawn', { ...spec, ...at }).then(
      ({ ptyId }) => {
        client.bind(ptyId, {
          data: (d) => this.dataListeners.forEach((l) => l(d)),
          exit: (e) => this.exitListeners.forEach((l) => l(e)),
          moved: (next) => {
            live = next
            if (this.size) next.notify('pty.resize', { ptyId, ...this.size })
          }
        })
        this.ready(
          {
            write: (data) => live.notify('pty.write', { ptyId, data }),
            resize: (cols, rows) => live.notify('pty.resize', { ptyId, cols, rows }),
            kill: () => void live.call('pty.kill', { ptyId }).catch(() => undefined)
          },
          { ...spec, ...at }
        )
      },
      (error: Error) => this.errorListeners.forEach((l) => l(error))
    )
  }

  private startLocal(spec: PtySpawnParams, fallback: PtyBackend): void {
    let inner: PtyHandle
    try {
      inner = fallback.spawn({ ...spec, ...(this.size ?? {}) })
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      return this.errorListeners.forEach((l) => l(failure))
    }
    inner.onData((d) => this.dataListeners.forEach((l) => l(d)))
    inner.onExit((e) => this.exitListeners.forEach((l) => l(e)))
    inner.onError((e) => this.errorListeners.forEach((l) => l(e)))
    this.ready(inner, { ...spec, ...(this.size ?? {}) })
  }
}

/** PTYs on a host daemon (falling back to `fallback` while it is unavailable). */
export const hostPtyBackend = (host: () => Promise<HostClient | null>, fallback: PtyBackend): PtyBackend => ({
  spawn: (spec) => new HostedPty(spec, host(), fallback)
})
