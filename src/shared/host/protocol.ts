import type { AppError } from '../errors'

/**
 * The execution-host protocol (ADR 0022): how Hiveory talks to a host daemon
 * (`hiveoryd`) that owns processes, files and git on a machine. The same frames
 * run over a local utility process and over an SSH channel, so Work and Bots
 * share one remote layer. Bump HOST_PROTOCOL only for breaking changes.
 */
// 2: remote daemons outlive their connection; pty.attach takes a terminal back after a reconnect (ADR 0025).
// 3: terminals have keys and pty.list; a local daemon outlives the app and needs a mutual hello (ADR 0050).
// Frozen core (ADR 0050 §8), never changed in meaning: hello, auth, hold, pty.list, pty.attach, pty.kill,
// pty.write, pty.resize, pty.data, pty.exit, relay.kept, relay.hook, relay.mcp, relay.reply. A breaking
// change only adds frames and bumps this number.
export const HOST_PROTOCOL = 3

export interface PtySpawnParams {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  /** Start from the host's own environment and apply `env` on top (remote hosts: never ship this computer's env). */
  inheritEnv?: boolean
  /** Who the terminal belongs to (an agent instance id, a shell id), so a later app can find it again (ADR 0050). */
  key?: string
}

/** Settings › Agents › Terminal host (ADR 0050 §11): where this computer's terminals run, and how many. */
export interface TerminalHostStatus {
  /** daemon: outlives Hiveory; utility: a separate process that ends with it; in-process: inside Hiveory. */
  mode: 'daemon' | 'utility' | 'in-process'
  pid?: number
  /** When the daemon started (ms since the epoch). */
  since?: number
  /** Live terminals it holds now. */
  terminals: number
  protocol: number
  /** The app version its own runtime copy is (installed builds); absent: it runs from the app. */
  runtime?: string
}

/** A hook a CLI reported to the daemon's relay while no app was attached (ADR 0050 §6). */
export interface KeptHook {
  instanceId: string
  event: string
  payload: unknown
  at: number
}

/** A terminal the host holds, as `pty.list` reports it. */
export interface HostedTerminalInfo {
  ptyId: string
  key?: string
  pid: number
  alive: boolean
  startedAt: number
  /** How it ended, for one that ended while no client was attached. */
  exit?: { code: number | null; signal: number | null }
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
  git: ['repositoryRoot', 'currentBranch', 'hasCommits', 'localBranchExists', 'refExists', 'localBranches', 'remoteBranches', 'fetch', 'status', 'branchNameProblem', 'init', 'defaultBranch'],
  worktrees: ['create', 'remove', 'deleteBranchIfMerged', 'repairLink', 'list', 'prune', 'recreate'],
  files: ['list', 'search', 'read', 'write', 'create', 'rename', 'remove', 'paste', 'watch', 'resolveIn'],
  fs: ['exists', 'isDirectory', 'mkdirp', 'readDir', 'writeText'],
  /** The CLIs' own session history on that machine (the side panel's Sessions, ADR 0043). */
  sessions: ['list']
} as const
export type HostService = keyof typeof HOST_SERVICES

/** Calls that get exactly one result. */
export interface HostCalls {
  /**
   * First call on every connection. A daemon with a token (the local one, ADR 0050) answers `proof`,
   * HMAC(token, "daemon" + nonce), and its own `nonce`; nothing but `auth` is served until the client
   * answers it. A daemon without a token (utility process, SSH stdio) answers neither.
   */
  hello: {
    params: { protocol: number; nonce?: string }
    result: { protocol: number; pid: number; platform: string; home: string; nonce?: string; proof?: string }
  }
  /** The client's answer to the daemon's nonce: HMAC(token, "client" + nonce). A wrong one closes the connection. */
  auth: { params: { proof: string }; result: null }
  /** Every terminal the host holds, live or ended while no client was attached. */
  'pty.list': { params: null; result: HostedTerminalInfo[] }
  /**
   * The client is about to leave with its terminals kept: from now on their output is kept for the
   * next client. Answered after every frame sent before it, so nothing falls between the two.
   */
  hold: { params: null; result: null }
  /** Ends every terminal and the daemon itself ("Quit and stop agents"). */
  shutdown: { params: null; result: null }
  /** The hooks the relay kept while no app was attached, oldest first; they are handed over once. */
  'relay.kept': { params: null; result: KeptHook[] }
  /** How long terminals stay once no app is attached: null keeps them until they end (ADR 0050 §7). */
  'grace.set': { params: { ms: number | null }; result: null }
  'pty.spawn': { params: PtySpawnParams; result: { ptyId: string; pid: number } }
  'pty.kill': { params: { ptyId: string }; result: null }
  /**
   * Takes a terminal back after a reconnect: its output since the link dropped, or how it ended.
   * Until attached, a surviving terminal's output is kept for it.
   */
  'pty.attach': { params: { ptyId: string }; result: { alive: true; data: string } | { alive: false; code: number | null; signal: number | null } }
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
  /** The app's answer to a `relay.mcp` request (null: accepted, no reply). */
  'relay.reply': { requestId: string; body: unknown }
}

/** What the host reports on its own. */
export interface HostEvents {
  'pty.data': { ptyId: string; data: string }
  'pty.exit': { ptyId: string; code: number | null; signal: number | null }
  /** A watched folder changed (`scope` is the id the watch was opened with). */
  'files.changed': { scope: string; paths: string[] }
  /** A CLI's hook reached the daemon's relay (ADR 0050 §6). */
  'relay.hook': { instanceId: string; event: string; payload: unknown }
  /** An agent's MCP request reached the relay; the app answers with `relay.reply`. */
  'relay.mcp': { requestId: string; instanceId: string; body: unknown }
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
