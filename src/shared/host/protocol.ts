import type { AppError } from '../errors'

/**
 * The execution-host protocol (ADR 0022): how Hiveory talks to a host daemon
 * (`hiveoryd`) that owns processes, files and git on a machine. The same frames
 * run over a local utility process and over an SSH channel, so Work and Bots
 * share one remote layer. Bump HOST_PROTOCOL only for breaking changes.
 */
export const HOST_PROTOCOL = 1

export interface PtySpawnParams {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  /** Start from the host's own environment and apply `env` on top (remote hosts: never ship this computer's env). */
  inheritEnv?: boolean
}

export interface ExecParams {
  file: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  /** Text written to the program's stdin (e.g. a Dockerfile for `docker build -`). */
  stdin?: string
}

/** Services the host runs on its own machine, so paths and tools are native there. */
export const HOST_SERVICES = {
  git: ['repositoryRoot', 'currentBranch', 'hasCommits', 'localBranchExists', 'refExists', 'localBranches', 'status', 'branchNameProblem', 'init', 'defaultBranch'],
  worktrees: ['create', 'remove', 'deleteBranchIfMerged', 'repairLink', 'list', 'prune', 'recreate'],
  files: ['list', 'search', 'read', 'write', 'create', 'rename', 'remove', 'paste', 'watch', 'resolveIn'],
  fs: ['exists', 'isDirectory', 'mkdirp', 'readDir', 'writeText']
} as const
export type HostService = keyof typeof HOST_SERVICES

/** Calls that get exactly one result. */
export interface HostCalls {
  hello: { params: { protocol: number }; result: { protocol: number; pid: number; platform: string; home: string } }
  'pty.spawn': { params: PtySpawnParams; result: { ptyId: string; pid: number } }
  'pty.kill': { params: { ptyId: string }; result: null }
  /** Runs a program without a shell and returns its output. */
  exec: { params: ExecParams; result: { code: number | null; stdout: string; stderr: string } }
  /** Where each named program is on the host's login PATH. */
  which: { params: { names: string[] }; result: Record<string, string> }
  /** A method of one of HOST_SERVICES, with JSON arguments. */
  invoke: { params: { service: HostService; method: string; args: unknown[] }; result: unknown }
}

/** Fire-and-forget messages (keystrokes and resizes must not wait for a round trip). */
export interface HostNotifications {
  'pty.write': { ptyId: string; data: string }
  'pty.resize': { ptyId: string; cols: number; rows: number }
}

/** What the host reports on its own. */
export interface HostEvents {
  'pty.data': { ptyId: string; data: string }
  'pty.exit': { ptyId: string; code: number | null; signal: number | null }
  /** A watched folder changed (`scope` is the id the watch was opened with). */
  'files.changed': { scope: string; paths: string[] }
}

export type HostCall = keyof HostCalls

/** A failure as it crosses the wire: typed app errors and git failures keep their shape. */
export interface HostFailure {
  message: string
  app?: AppError
  git?: { args: string[]; stderr: string; exitCode: number | null }
}

export type HostFrame =
  | { kind: 'call'; id: number; method: HostCall; params: unknown }
  | { kind: 'result'; id: number; ok: true; value: unknown }
  | { kind: 'result'; id: number; ok: false; error: string; failure?: HostFailure }
  | { kind: 'notify'; method: keyof HostNotifications; params: unknown }
  | { kind: 'event'; event: keyof HostEvents; params: unknown }

/** A bidirectional frame channel: a utility-process port, an SSH channel, or an in-memory pair in tests. */
export interface HostTransport {
  send(frame: HostFrame): void
  onFrame(listener: (frame: HostFrame) => void): void
  onClose(listener: () => void): void
  close(): void
}

/** Two connected in-memory transports (tests, and anything that runs a host in-process). */
export const transportPair = (): [HostTransport, HostTransport] => {
  const make = () => {
    const frames: Array<(f: HostFrame) => void> = []
    const closes: Array<() => void> = []
    return { frames, closes, closed: false }
  }
  const a = make()
  const b = make()
  const side = (self: ReturnType<typeof make>, peer: ReturnType<typeof make>): HostTransport => ({
    // Async like a real channel, so neither side relies on re-entrant delivery.
    send: (frame) => {
      if (self.closed) return
      const copy = structuredClone(frame)
      queueMicrotask(() => {
        if (!peer.closed) for (const l of peer.frames) l(copy)
      })
    },
    onFrame: (l) => void self.frames.push(l),
    onClose: (l) => void self.closes.push(l),
    close: () => {
      if (self.closed) return
      self.closed = true
      peer.closed = true
      for (const l of [...self.closes, ...peer.closes]) l()
    }
  })
  return [side(a, b), side(b, a)]
}
