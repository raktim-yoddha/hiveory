import { execFile, spawn as spawnProcess, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import * as pty from '@lydell/node-pty'
import { AppException } from '@shared/errors'
import {
  HOST_PROTOCOL,
  HOST_SERVICES,
  type ExecParams,
  type HostCalls,
  type HostFailure,
  type HostFrame,
  type HostService,
  type HostTransport,
  type HostedProcInfo,
  type HostedTerminalInfo,
  type ProcSpawnParams,
  type PtySpawnParams
} from '@shared/host/protocol'
import { killTree } from '../main/services/pty/spawn-target'
import { findExecutable } from '../main/services/cli/discovery'
import { FileService } from '../main/services/files/file-service'
import { GitCommandError, GitService } from '../main/services/git/git-service'
import { WorktreeService } from '../main/services/git/worktree-service'
import { newNonce, prove, verifyProof } from '../main/services/hosts/handshake'
import { SessionHistoryService } from '../main/services/sessions/session-history'

const MAX_EXEC_OUTPUT = 32 * 1024 * 1024

/** Deleted files go here on a host without a desktop trash (remote machines): recoverable by hand. */
const remoteTrash = async (path: string): Promise<void> => {
  const dir = join(homedir(), '.hiveory-host', 'trash')
  await mkdir(dir, { recursive: true })
  await rename(path, join(dir, `${Date.now()}-${basename(path)}`))
}

/** A failure keeps its type across the wire, so callers' `instanceof` checks still work. */
const toFailure = (error: unknown): HostFailure => {
  if (error instanceof AppException) return { message: error.message, app: error.error }
  if (error instanceof GitCommandError) return { message: error.message, git: { args: error.args, stderr: error.stderr, exitCode: error.exitCode } }
  return { message: error instanceof Error ? error.message : String(error) }
}

/** Runs a program without a shell (optionally feeding stdin) and collects its output. */
export const runProgram = (p: ExecParams): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = execFile(
      p.file,
      p.args,
      { cwd: p.cwd, env: p.env ? { ...process.env, ...p.env } : process.env, timeout: p.timeoutMs, windowsHide: true, maxBuffer: MAX_EXEC_OUTPUT },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr || (error && code === null ? error.message : '')) })
      }
    )
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(p.stdin ?? '')
  })

export interface HostServeOptions {
  /** How this machine trashes files: the OS trash locally, a folder under ~/.hiveory-host remotely. */
  trash?: (path: string) => Promise<void>
  /** Where the CLIs keep their history (the user's home; tests use a folder of their own). */
  home?: string
  /** After `shutdown` ended every terminal: the daemon process exits (ADR 0050). */
  onShutdown?: () => void
  /** Calls and notifications the daemon adds (its relay, its grace policy: ADR 0050). */
  calls?: Partial<Record<string, (params: unknown) => unknown>>
  notifications?: Partial<Record<string, (params: unknown) => void>>
  /** The attached client went away. */
  onDetach?: () => void
}

/** Output kept per terminal while no client is attached (the newest part wins). */
const MAX_KEPT = 2 * 1024 * 1024
/** A headless run's whole stdout is kept up to this much (a reply is rebuilt from it, ADR 0051). */
const MAX_PROC_OUT = 8 * 1024 * 1024
const MAX_PROC_ERR = 64 * 1024

interface HostedProc {
  child: ChildProcess
  key: string
  out: string
  err: string
  /** Undefined while it runs. */
  code?: number | null
  /** An attached client receives its output as it comes. */
  watched: boolean
}

interface HostedTerminal {
  child: pty.IPty
  key?: string
  startedAt: number
  /** Output since the last client went away; null while a client is attached. */
  kept: string[] | null
  keptSize: number
}

/**
 * Everything a host daemon owns, independent of who is connected: its
 * terminals, git, files. Locally one transport uses it for its whole life;
 * on a remote machine it outlives SSH connections (ADR 0025).
 */
export interface HostState {
  terminals: Map<string, HostedTerminal>
  /** Headless runs (chat turns, ADR 0051), running or ended while nobody watched. */
  procs: Map<string, HostedProc>
  /** Terminals that ended while no client was attached, with how they ended. */
  ended: Map<string, { code: number | null; signal: number | null; key?: string; pid: number; startedAt: number }>
  services: Record<HostService, object>
  /** The attached client, if any. */
  out: HostTransport | null
  seq: number
  onShutdown?: () => void
  calls?: HostServeOptions['calls']
  notifications?: HostServeOptions['notifications']
  onDetach?: () => void
}

export const createHostState = (options: HostServeOptions = {}): HostState => {
  const git = new GitService()
  const state: HostState = { terminals: new Map(), procs: new Map(), ended: new Map(), services: {} as HostState['services'], out: null, seq: 0, onShutdown: options.onShutdown, calls: options.calls, notifications: options.notifications, onDetach: options.onDetach }
  state.services = {
    git,
    worktrees: new WorktreeService(git),
    files: new FileService(options.trash ?? remoteTrash, (scope, paths) => state.out?.send({ kind: 'event', event: 'files.changed', params: { scope, paths } })),
    fs: {
      exists: (path: string) => existsSync(path),
      isDirectory: (path: string) => {
        try {
          return statSync(path).isDirectory()
        } catch {
          return false
        }
      },
      mkdirp: (path: string) => void mkdirSync(path, { recursive: true }),
      readDir: async (path: string) => (await readdir(path, { withFileTypes: true }).catch(() => [])).map((d) => ({ name: d.name, dir: d.isDirectory() })),
      writeText: async (path: string, content: string) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, 'utf8')
      }
    },
    // Unreadable session files are skipped either way; the host has no log of its own.
    sessions: new SessionHistoryService({ info: () => undefined, warn: () => undefined, error: () => undefined }, options.home)
  }
  return state
}

/** Ends every terminal and watcher (a local daemon whose app went away, or a remote one past its grace period). */
export const disposeHostState = (state: HostState): void => {
  for (const { child } of state.terminals.values()) {
    try {
      child.kill()
    } catch {
      // Already gone.
    }
  }
  state.terminals.clear()
  for (const proc of state.procs.values()) killTree(proc.child)
  state.procs.clear()
  ;(state.services.files as FileService).closeAll()
}

/**
 * Serves one client over `transport`. With `persist`, terminals and watchers
 * survive the transport closing: their output is kept until a later client
 * takes them back with `pty.attach`. Otherwise they end with it. A newer
 * client replaces an older one (its connection is usually already dead).
 */
export const attachHost = (state: HostState, transport: HostTransport, persist: boolean): void => {
  const previous = state.out
  state.out = transport
  // Terminals wait for their new client to take them back; their output is kept meanwhile.
  for (const t of state.terminals.values()) t.kept ??= []
  for (const proc of state.procs.values()) proc.watched = false
  previous?.close()

  const send = (frame: HostFrame): void => {
    if (state.out === transport) transport.send(frame)
  }

  const spawn = (p: PtySpawnParams): HostCalls['pty.spawn']['result'] => {
    const env = p.inheritEnv ? ({ ...process.env, ...p.env } as Record<string, string>) : p.env
    const child = pty.spawn(p.file, p.args, {
      name: 'xterm-256color',
      cols: p.cols,
      rows: p.rows,
      cwd: p.cwd,
      env,
      // Bundled modern ConPTY renders far more faithfully than the inbox Windows one.
      ...(process.platform === 'win32' ? { useConptyDll: true } : {})
    })
    const ptyId = `p${++state.seq}`
    const terminal: HostedTerminal = { child, key: p.key, startedAt: Date.now(), kept: null, keptSize: 0 }
    state.terminals.set(ptyId, terminal)
    child.onData((data) => {
      if (terminal.kept && state.terminals.get(ptyId) === terminal) {
        terminal.kept.push(data)
        terminal.keptSize += data.length
        while (terminal.keptSize > MAX_KEPT && terminal.kept.length > 1) terminal.keptSize -= terminal.kept.shift()!.length
      } else state.out?.send({ kind: 'event', event: 'pty.data', params: { ptyId, data } })
    })
    child.onExit(({ exitCode, signal }) => {
      state.terminals.delete(ptyId)
      const exit = { code: exitCode, signal: signal ?? null }
      if (terminal.kept || !state.out) state.ended.set(ptyId, { ...exit, key: terminal.key, pid: child.pid, startedAt: terminal.startedAt })
      else state.out.send({ kind: 'event', event: 'pty.exit', params: { ptyId, ...exit } })
    })
    return { ptyId, pid: child.pid }
  }

  const attach = ({ ptyId }: { ptyId: string }): HostCalls['pty.attach']['result'] => {
    const terminal = state.terminals.get(ptyId)
    if (!terminal) {
      const ended = state.ended.get(ptyId)
      state.ended.delete(ptyId)
      return { alive: false, code: ended?.code ?? null, signal: ended?.signal ?? null }
    }
    const data = (terminal.kept ?? []).join('')
    terminal.kept = null
    terminal.keptSize = 0
    return { alive: true, data }
  }

  const spawnProc = (p: ProcSpawnParams): HostCalls['proc.spawn']['result'] => {
    const child = spawnProcess(p.file, p.args, { cwd: p.cwd, env: p.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const procId = `r${++state.seq}`
    const proc: HostedProc = { child, key: p.key, out: '', err: '', watched: true }
    state.procs.set(procId, proc)
    const deliver = (stream: 'out' | 'err', data: string): void => {
      if (stream === 'out') proc.out = (proc.out + data).slice(-MAX_PROC_OUT)
      else proc.err = (proc.err + data).slice(-MAX_PROC_ERR)
      if (proc.watched) state.out?.send({ kind: 'event', event: 'proc.data', params: { procId, stream, data } })
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => deliver('out', d))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (d: string) => deliver('err', d))
    const ended = (code: number | null): void => {
      if (proc.code !== undefined) return
      proc.code = code
      // Seen ending by its client: done. Otherwise it waits, whole, for the next one (proc.attach).
      if (proc.watched && state.out) {
        state.out.send({ kind: 'event', event: 'proc.exit', params: { procId, code } })
        state.procs.delete(procId)
      }
    }
    child.on('close', (code) => ended(code))
    child.on('error', (error) => {
      proc.err = (proc.err + error.message).slice(-MAX_PROC_ERR)
      ended(null)
    })
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(p.stdin ?? '')
    return { procId, pid: child.pid ?? 0 }
  }

  const attachProc = ({ procId }: { procId: string }): HostCalls['proc.attach']['result'] => {
    const proc = state.procs.get(procId)
    if (!proc) return { alive: false, out: '', err: '', code: null }
    const alive = proc.code === undefined
    if (alive) proc.watched = true
    else state.procs.delete(procId)
    return { alive, out: proc.out, err: proc.err, code: proc.code ?? null }
  }

  const listProcs = (): HostedProcInfo[] =>
    [...state.procs].map(([procId, p]) => ({ procId, key: p.key, alive: p.code === undefined, ...(p.code !== undefined ? { code: p.code } : {}) }))

  const list = (): HostedTerminalInfo[] => [
    ...[...state.terminals].map(([ptyId, t]) => ({ ptyId, key: t.key, pid: t.child.pid, alive: true, startedAt: t.startedAt })),
    ...[...state.ended].map(([ptyId, e]) => ({ ptyId, key: e.key, pid: e.pid, alive: false, startedAt: e.startedAt, exit: { code: e.code, signal: e.signal } }))
  ]

  const invoke = async ({ service, method, args }: HostCalls['invoke']['params']): Promise<unknown> => {
    const allowed = HOST_SERVICES[service] as readonly string[] | undefined
    if (!allowed?.includes(method)) throw new Error(`Not allowed on this host: ${service}.${method}`)
    const target = state.services[service] as Record<string, (...a: unknown[]) => unknown>
    return target[method]!(...args)
  }

  const call = async (method: string, params: unknown): Promise<unknown> => {
    switch (method) {
      case 'hello':
        return { protocol: HOST_PROTOCOL, pid: process.pid, platform: process.platform, home: homedir() }
      case 'pty.spawn':
        return spawn(params as PtySpawnParams)
      case 'pty.attach':
        return attach(params as { ptyId: string })
      case 'pty.list':
        return list()
      case 'proc.spawn':
        return spawnProc(params as ProcSpawnParams)
      case 'proc.attach':
        return attachProc(params as { procId: string })
      case 'proc.list':
        return listProcs()
      case 'proc.kill': {
        const proc = state.procs.get((params as { procId: string }).procId)
        if (proc) killTree(proc.child)
        return null
      }
      case 'auth':
        return null
      case 'hold':
        for (const t of state.terminals.values()) t.kept ??= []
        return null
      case 'shutdown':
        disposeHostState(state)
        state.ended.clear()
        if (state.onShutdown) setImmediate(state.onShutdown)
        return null
      case 'pty.kill': {
        const { ptyId } = params as { ptyId: string }
        try {
          state.terminals.get(ptyId)?.child.kill()
        } catch {
          // Already gone.
        }
        return null
      }
      case 'exec':
        return runProgram(params as ExecParams)
      case 'which': {
        const env = { platform: process.platform, path: process.env.PATH ?? process.env.Path ?? '', pathExt: process.env.PATHEXT }
        const found: Record<string, string> = {}
        for (const name of (params as { names: string[] }).names) {
          const path = findExecutable(name, env)
          if (path) found[name] = path
        }
        return found
      }
      case 'invoke':
        return invoke(params as HostCalls['invoke']['params'])
      default: {
        const extra = state.calls?.[method]
        if (extra) return extra(params)
        throw new Error(`Unknown host call: ${method}`)
      }
    }
  }

  transport.onFrame((frame: HostFrame) => {
    if (state.out !== transport) return
    if (frame.kind === 'call') {
      call(frame.method, frame.params).then(
        (value) => send({ kind: 'result', id: frame.id, ok: true, value: value ?? null }),
        (error: unknown) => {
          const failure = toFailure(error)
          send({ kind: 'result', id: frame.id, ok: false, error: failure.message, failure })
        }
      )
    } else if (frame.kind === 'notify' && state.notifications?.[frame.method]) {
      state.notifications[frame.method]!(frame.params)
    } else if (frame.kind === 'notify') {
      const p = frame.params as { ptyId: string; data?: string; cols?: number; rows?: number }
      const child = state.terminals.get(p.ptyId)?.child
      try {
        if (frame.method === 'pty.write' && p.data !== undefined) child?.write(p.data)
        else if (frame.method === 'pty.resize' && p.cols && p.rows) child?.resize(p.cols, p.rows)
      } catch {
        // A PTY that is exiting can refuse a write or resize; never fatal.
      }
    }
  })

  transport.onClose(() => {
    if (state.out !== transport) return
    state.out = null
    // Runs carry on unwatched; the next client takes them back whole.
    for (const proc of state.procs.values()) proc.watched = false
    state.onDetach?.()
    if (!persist) return disposeHostState(state)
    for (const t of state.terminals.values()) t.kept ??= []
  })
}

/**
 * A connection to a daemon with a token (the local one, ADR 0050 §2): only `hello` and `auth`
 * are answered until the client proves the token, then it is served like any other. A
 * connection that calls anything else first, or answers wrongly, is closed.
 */
export const gateHost = (state: HostState, transport: HostTransport, token: string): void => {
  const nonce = newNonce()
  let open = false
  transport.onFrame((frame) => {
    if (open) return
    const p = (frame.kind === 'call' ? frame.params : null) as { nonce?: unknown; proof?: unknown } | null
    if (frame.kind === 'call' && frame.method === 'hello' && typeof p?.nonce === 'string') {
      const value = { protocol: HOST_PROTOCOL, pid: process.pid, platform: process.platform, home: homedir(), nonce, proof: prove(token, 'daemon', p.nonce) }
      return transport.send({ kind: 'result', id: frame.id, ok: true, value })
    }
    if (frame.kind === 'call' && frame.method === 'auth' && verifyProof(token, 'client', nonce, p?.proof)) {
      open = true
      transport.send({ kind: 'result', id: frame.id, ok: true, value: null })
      // After this frame's delivery, so the server never sees (and answers) the auth call twice.
      return queueMicrotask(() => attachHost(state, transport, true))
    }
    transport.close()
  })
}

/**
 * The host daemon (`hiveoryd`, ADR 0022) for one transport: it owns PTYs,
 * processes, files and git on its machine and answers over any transport. Git,
 * worktrees and files run here through the same classes main uses locally, so
 * paths and tools are native to the machine. It never reaches back into
 * Hiveory; when the transport closes, its PTYs and watchers end.
 */
export const serveHost = (transport: HostTransport, options: HostServeOptions = {}): void => attachHost(createHostState(options), transport, false)
