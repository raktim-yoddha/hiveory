import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST_PROTOCOL, type HostFrame, type HostTransport } from '@shared/host/protocol'
import { adoptLoginShellPath } from '../main/app/shell-path'
import { newToken } from '../main/services/hosts/handshake'
import { lineTransport } from '../main/services/hosts/line-transport'
import { localEndpointFile, localEndpointPath, type LocalEndpoint } from '../main/services/hosts/local-endpoint'
import { gracePolicy } from './grace'
import { publish } from './endpoint-owner'
import { createRelay } from './relay'
import { attachHost, createHostState, disposeHostState, gateHost, serveHost, type HostState } from './host-server'

/**
 * hiveoryd entry. Locally it runs as an Electron utility process (frames over its
 * parent port), so a crash in native PTY code never takes the app down. On a
 * remote machine (ADR 0022, 0025) `--daemon` runs it detached on a private unix
 * socket, so terminals outlive SSH connections, and each connection runs
 * `--attach`, a pipe between ssh's stdio and that socket that starts the daemon
 * when none is running. `--daemon --local <dir>` is this computer's own daemon (ADR 0050): started
 * detached by the app, it outlives it on a private named pipe or socket and serves only clients
 * that prove its token. Without either flag it serves stdio directly.
 */
interface ParentPort {
  on(event: 'message', listener: (message: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort



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

/** Ends the daemon once nobody is attached and `keep` (given how long it has been idle) says so. */
const idleExit = (state: HostState, server: Server, keep: (idleMs: number) => boolean, cleanup: () => void): void => {
  let since = Date.now()
  server.on('connection', (socket: Socket) => socket.on('close', () => (since = Date.now())))
  setInterval(() => {
    if (state.out) {
      since = Date.now()
      return
    }
    if (keep(Date.now() - since)) return
    disposeHostState(state)
    server.close()
    cleanup()
    process.exit(0)
  }, 10_000)
}

/** A remote machine's daemon, reached through `--attach` over SSH (ADR 0025). */
const runDaemon = async (): Promise<void> => {
  // Started from a non-login shell: take the login PATH so CLIs in ~/.local/bin, nvm, Homebrew… are found.
  await adoptLoginShellPath(quiet)
  keepOwnNodeOnPath()
  const grace = gracePolicy()
  const state = createHostState({ calls: grace.calls })
  const server = createServer((socket) => attachHost(state, lineTransport(socket, socket, () => socket.destroy()), true))
  // Another daemon won the race to start; it serves everyone.
  if (!(await publish(server, socketPath()).catch(() => false))) process.exit(0)
  idleExit(state, server, (idle) => grace.keep(state, idle), () => undefined)
}

/**
 * This computer's daemon (ADR 0050): started detached by the app, it keeps every terminal until it
 * ends, whether an app is attached or not, and exits only when it has neither terminals nor an app.
 * Its endpoint and token are in `<dir>/endpoint.json`, readable by this user only.
 */
const runLocalDaemon = async (dir: string): Promise<void> => {
  // The app's Node mode must not reach the programs started here.
  delete process.env.ELECTRON_RUN_AS_NODE
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const token = newToken()
  const incarnation = randomBytes(8).toString('hex')
  const path = localEndpointPath(dir, HOST_PROTOCOL)
  const file = join(dir, localEndpointFile(HOST_PROTOCOL))
  const forget = (): void => {
    // Only our own record: a newer daemon may already have written its own.
    try {
      if ((JSON.parse(readFileSync(file, 'utf8')) as LocalEndpoint).incarnation === incarnation) unlinkSync(file)
    } catch {
      // Gone already.
    }
  }
  // Hooks and agent tools reach the app through here, so their URLs outlive it (ADR 0050 §6).
  const relay = createRelay(() => state.out, join(dir, 'relay.json'), quiet)
  const grace = gracePolicy()
  const state: HostState = createHostState({
    onShutdown: () => {
      forget()
      process.exit(0)
    },
    calls: { ...relay.calls, ...grace.calls },
    notifications: relay.notifications,
    onDetach: relay.detached
  })
  await relay.server.start()
  const server = createServer((socket) => gateHost(state, lineTransport(socket, socket, () => socket.destroy()), token))
  if (!(await publish(server, path).catch(() => false))) process.exit(0)
  const endpoint: LocalEndpoint = { protocol: HOST_PROTOCOL, pid: process.pid, incarnation, path, token, relay: relay.server.endpoint, exe: process.execPath, since: Date.now() }
  writeFileSync(`${file}.tmp`, JSON.stringify(endpoint), { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
  idleExit(state, server, (idle) => grace.keep(state, idle), forget)
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
  } catch {
    // A socket left by a daemon that died is replaced by the new daemon itself (publish), never removed here.
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
  const local = process.argv.indexOf('--local')
  if (process.argv.includes('--daemon') && local > 0 && process.argv[local + 1]) return runLocalDaemon(process.argv[local + 1]!)
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
