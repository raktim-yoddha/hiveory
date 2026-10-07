import { execFile } from 'node:child_process'
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
  type PtySpawnParams
} from '@shared/host/protocol'
import { findExecutable } from '../main/services/cli/discovery'
import { FileService } from '../main/services/files/file-service'
import { GitCommandError, GitService } from '../main/services/git/git-service'
import { WorktreeService } from '../main/services/git/worktree-service'

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
}

/** Output kept per terminal while no client is attached (the newest part wins). */
const MAX_KEPT = 2 * 1024 * 1024

interface HostedTerminal {
  child: pty.IPty
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
  /** Terminals that ended while no client was attached, with how they ended. */
  ended: Map<string, { code: number | null; signal: number | null }>
  services: Record<HostService, object>
  /** The attached client, if any. */
  out: HostTransport | null
  seq: number
}

export const createHostState = (options: HostServeOptions = {}): HostState => {
  const git = new GitService()
  const state: HostState = { terminals: new Map(), ended: new Map(), services: {} as HostState['services'], out: null, seq: 0 }
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
    }
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
    const terminal: HostedTerminal = { child, kept: null, keptSize: 0 }
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
      if (terminal.kept || !state.out) state.ended.set(ptyId, exit)
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
      default:
        throw new Error(`Unknown host call: ${method}`)
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
    if (!persist) return disposeHostState(state)
    for (const t of state.terminals.values()) t.kept ??= []
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
