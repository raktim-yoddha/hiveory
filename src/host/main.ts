import { spawn } from 'node:child_process'
import { chmodSync, openSync, unlinkSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'
import { delimiter, dirname, join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { HostFrame, HostTransport } from '@shared/host/protocol'
import { adoptLoginShellPath } from '../main/app/shell-path'
import { attachHost, createHostState, disposeHostState, serveHost } from './host-server'

/**
 * hiveoryd entry. Locally it runs as an Electron utility process (frames over its
 * parent port), so a crash in native PTY code never takes the app down. On a
 * remote machine (ADR 0022, 0025) `--daemon` runs it detached on a private unix
 * socket, so terminals outlive SSH connections, and each connection runs
 * `--attach`, a pipe between ssh's stdio and that socket that starts the daemon
 * when none is running. Without either flag it serves stdio directly.
 */
interface ParentPort {
  on(event: 'message', listener: (message: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort

/** A remote daemon with nobody attached keeps its terminals this long, then ends. */
const GRACE_MS = 5 * 60_000
/** …and lingers only briefly when it has no terminals to keep. */
const IDLE_MS = 60_000

const portTransport = (port: ParentPort): HostTransport => {
  const closes: Array<() => void> = []
  process.on('disconnect', () => closes.forEach((l) => l()))
  return {
    send: (frame) => port.postMessage(frame),
    onFrame: (listener) => port.on('message', (message) => listener(message.data as HostFrame)),
    onClose: (listener) => void closes.push(listener),
    close: () => process.exit(0)
  }
}

/** One JSON frame per line over a pair of streams (stdio, or a socket). */
const lineTransport = (input: Readable, output: Writable, close: () => void): HostTransport => {
  const frames: Array<(f: HostFrame) => void> = []
  const closes: Array<() => void> = []
  let buffer = ''
  let closed = false
  const end = (): void => {
    if (closed) return
    closed = true
    closes.forEach((l) => l())
  }
  input.setEncoding('utf8')
  input.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        try {
          const frame = JSON.parse(line) as HostFrame
          for (const l of frames) l(frame)
        } catch {
          // A malformed line is ignored; the client times the call out.
        }
      }
      newline = buffer.indexOf('\n')
    }
  })
  input.on('end', end)
  input.on('close', end)
  input.on('error', end)
  output.on('error', end)
  return {
    send: (frame) => {
      if (!closed) output.write(`${JSON.stringify(frame)}\n`)
    },
    onFrame: (l) => void frames.push(l),
    onClose: (l) => void closes.push(l),
    close: () => {
      end()
      close()
    }
  }
}

// A bug in one request must not end every PTY on this machine.
process.on('uncaughtException', (error) => console.error('hiveoryd: uncaught exception', error))
process.on('unhandledRejection', (reason) => console.error('hiveoryd: unhandled rejection', reason))

const here = (): string => dirname(fileURLToPath(import.meta.url))
const socketPath = (): string => join(here(), 'hiveoryd.sock')
const quiet = { info: () => undefined, warn: (m: string) => console.error(m), error: (m: string) => console.error(m) }

/** Hiveory's own Node (when it installed one) stays first on PATH for the CLIs started here. */
const keepOwnNodeOnPath = (): void => {
  if (!/[/\\]\.hiveory-host[/\\]node[/\\]/.test(process.execPath)) return
  process.env.PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`
}

const runDaemon = async (): Promise<void> => {
  // Started from a non-login shell: take the login PATH so CLIs in ~/.local/bin, nvm, Homebrew… are found.
  await adoptLoginShellPath(quiet)
  keepOwnNodeOnPath()
  const state = createHostState()
  let since = Date.now()
  const server = createServer((socket) => {
    attachHost(
      state,
      lineTransport(socket, socket, () => socket.destroy()),
      true
    )
    socket.on('close', () => (since = Date.now()))
  })
  server.on('error', (error: NodeJS.ErrnoException) => {
    // Another daemon won the race to start; it serves everyone.
    console.error('hiveoryd: socket', error.code)
    process.exit(error.code === 'EADDRINUSE' ? 0 : 1)
  })
  server.listen(socketPath(), () => chmodSync(socketPath(), 0o600))
  setInterval(() => {
    if (state.out) return
    if (Date.now() - since < (state.terminals.size ? GRACE_MS : IDLE_MS)) return
    disposeHostState(state)
    server.close()
    try {
      unlinkSync(socketPath())
    } catch {
      // Already gone.
    }
    process.exit(0)
  }, 10_000)
}

const reach = (): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = connect(socketPath())
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })

const runAttach = async (): Promise<void> => {
  let socket: Socket | undefined
  try {
    socket = await reach()
  } catch (error) {
    // A socket left by a daemon that died: remove it so a new one can listen.
    if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      try {
        unlinkSync(socketPath())
      } catch {
        // Someone else did.
      }
    }
    const log = openSync(join(here(), 'daemon.log'), 'a')
    // Its own session (setsid), so the daemon survives this SSH session ending.
    spawn(process.execPath, [fileURLToPath(import.meta.url), '--daemon'], { detached: true, stdio: ['ignore', log, log], cwd: here() }).unref()
    for (let i = 0; i < 150 && !socket; i++) {
      await new Promise((r) => setTimeout(r, 100))
      socket = await reach().catch(() => undefined)
    }
  }
  if (!socket) {
    console.error('hiveoryd: the daemon did not start (see daemon.log next to host.mjs)')
    process.exit(1)
  }
  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
  process.stdin.on('end', () => socket.end())
  socket.on('close', () => process.exit(0))
  socket.on('error', () => process.exit(1))
}

const start = async (): Promise<void> => {
  if (process.argv.includes('--daemon')) return runDaemon()
  if (process.argv.includes('--attach')) return runAttach()
  // Over plain stdio the daemon starts from a non-login shell too. Locally it inherits Hiveory's (already adopted) PATH.
  if (!parentPort) {
    await adoptLoginShellPath(quiet)
    keepOwnNodeOnPath()
  }
  const transport = parentPort ? portTransport(parentPort) : lineTransport(process.stdin, process.stdout, () => process.exit(0))
  transport.onClose(() => setTimeout(() => process.exit(0), 100))
  serveHost(transport)
}
void start()
