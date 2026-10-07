import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { fail } from '@shared/errors'
import { HOST_PROTOCOL, type HostFrame, type HostTransport } from '@shared/host/protocol'
import type { Logger } from '../../app/logger'
import { HostClient } from './host-client'
import type { SshAuth } from './ssh-auth'

/** The node-pty build the remote daemon installs; kept equal to package.json (a test checks). */
export const NODE_PTY_VERSION = '1.2.0-beta.15'
/** The remote daemon needs a Node with stable ESM and fetch. */
export const MIN_REMOTE_NODE = 20
/** Where hiveoryd lives on a remote machine, relative to the login's home; one folder per protocol. */
export const REMOTE_DIR = `.hiveory-host/v${HOST_PROTOCOL}`

/**
 * Hiveory's own Node for machines without a usable one (ADR 0025, Orca's
 * "Orca-managed Node"): the official build, checked against these pinned
 * SHA-256 sums, unpacked to ~/.hiveory-host/node and put first on PATH for
 * everything Hiveory runs there.
 */
export const MANAGED_NODE = 'v24.11.0'
export const MANAGED_NODE_SHA256: Record<string, string> = {
  'linux-x64': 'b3c071cdf47aab867c3b2aa287257df12ec5d7c962bf922b32fd33226c4295fd',
  'linux-arm64': '4786d00c4d259d3ff0b2328307f764ef3ced65f2d6e9502d433e68d66238509d',
  'darwin-x64': '3884671e87f46f773832d98a0a6cabcc5ec4f637084f0f3515b69e66ea27f2f1',
  'darwin-arm64': '0be2ab2816a4fa02d1acff014a434f29f56d8d956f5af6a98b70ced6c5f4d201'
}
/** Every remote command runs under sh with Hiveory's Node (when it installed one) first on PATH. */
const WITH_NODE = 'PATH="$HOME/.hiveory-host/node/bin:$PATH"; export PATH; '

/** The official Node build for a probed machine, or null (Windows, musl, 32-bit…). */
export const managedNodeBuild = (info: RemoteInfo): string | null => {
  const os = info.platform === 'darwin' ? 'darwin' : info.platform === 'linux' && info.libc !== 'musl' ? 'linux' : ''
  const cpu = /^(x86_64|amd64)$/.test(info.arch) ? 'x64' : /^(aarch64|arm64)$/.test(info.arch) ? 'arm64' : ''
  return os && cpu ? `${os}-${cpu}` : null
}

/** Downloads, verifies and unpacks Hiveory's Node on the remote (sent to `sh -s`; prints the version). */
export const nodeInstallScript = (build: string): string => {
  const file = `node-${MANAGED_NODE}-${build}`
  return [
    'set -e',
    'mkdir -p "$HOME/.hiveory-host" && cd "$HOME/.hiveory-host"',
    'rm -rf node.tmp node.tgz && mkdir node.tmp',
    `url=https://nodejs.org/dist/${MANAGED_NODE}/${file}.tar.gz`,
    'if command -v curl >/dev/null 2>&1; then curl -fsSL "$url" -o node.tgz',
    'elif command -v wget >/dev/null 2>&1; then wget -q "$url" -O node.tgz',
    'else echo "HIVEORY_NO_DOWNLOADER" >&2; exit 3; fi',
    'sum=$( (sha256sum node.tgz 2>/dev/null || shasum -a 256 node.tgz) | cut -d" " -f1)',
    `[ "$sum" = "${MANAGED_NODE_SHA256[build]}" ] || { rm -f node.tgz; echo "HIVEORY_BAD_CHECKSUM" >&2; exit 4; }`,
    'tar -xzf node.tgz -C node.tmp --strip-components=1',
    'rm -rf node && mv node.tmp node && rm -f node.tgz',
    'node/bin/node -v || { echo "HIVEORY_NODE_WONT_RUN" >&2; exit 5; }',
    ''
  ].join('\n')
}

export interface SshTarget {
  /** An alias from ~/.ssh/config or user@host. Everything else (keys, ports, jumps) comes from the user's SSH config. */
  destination: string
  port?: number
}

export interface RemoteInfo {
  platform: string
  arch: string
  home: string
  node: string
  /** Linux only: 'musl' (Alpine…) or 'glibc'. */
  libc?: string
}

/** An SSH destination we pass to ssh: never an option, never shell syntax. */
const DESTINATION = /^[A-Za-z0-9_][A-Za-z0-9._-]*(@[A-Za-z0-9_][A-Za-z0-9._-]*)?$/
export const isSafeDestination = (destination: string): boolean => DESTINATION.test(destination) && destination.length <= 255

/** Reads the probe's lines: kernel, machine, home, node version (or "none"), and libc when known. */
export const parseProbe = (stdout: string): RemoteInfo => {
  const [kernel = '', machine = '', home = '', node = '', libc = ''] = stdout.trim().split(/\r?\n/).map((l) => l.trim())
  return { platform: kernel.toLowerCase(), arch: machine, home, node: node === 'none' ? '' : node.replace(/^v/, ''), ...(libc ? { libc } : {}) }
}

const nodeUsable = (version: string): boolean => Number(version.split('.')[0]) >= MIN_REMOTE_NODE

/** Turns ssh's own failure text into a message with the next step. */
export const explainSshFailure = (destination: string, stderr: string): never => {
  const text = stderr.trim()
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .* has changed/i.test(text)) {
    fail('FORBIDDEN', `${destination}'s host key has changed.`, {
      operation: 'Connect over SSH',
      hint: 'This can mean someone is intercepting the connection. If the machine was reinstalled, remove its old line from ~/.ssh/known_hosts and connect again.',
      detail: text
    })
  }
  if (/Host key verification failed|No .* host key is known/i.test(text)) {
    fail('FORBIDDEN', `${destination}'s host key is not trusted.`, {
      operation: 'Connect over SSH',
      hint: 'Connect again and choose Yes after checking the fingerprint, or connect once in a terminal (ssh ' + destination + ').',
      detail: text
    })
  }
  if (/Permission denied|Too many authentication failures/i.test(text)) {
    fail('FORBIDDEN', `${destination} refused the login.`, {
      operation: 'Connect over SSH',
      hint: 'Check the user, password or key. Key login (ssh-agent, or IdentityFile in ~/.ssh/config) needs no typing at all.',
      detail: text
    })
  }
  if (/Could not resolve hostname|Connection refused|timed out|No route to host|Network is unreachable/i.test(text)) {
    fail('NOT_FOUND', `${destination} is unreachable.`, { operation: 'Connect over SSH', hint: 'Check the address and that SSH is running there.', detail: text })
  }
  return fail('UNEXPECTED', `SSH to ${destination} failed.`, { operation: 'Connect over SSH', detail: text || 'No output from ssh.' })
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })

const isFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })

const accepts = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

/** A frame transport over a child process: one JSON frame per line on stdin/stdout. */
export const lineTransport = (child: ChildProcessWithoutNullStreams, log: Logger): HostTransport => {
  const frames: Array<(f: HostFrame) => void> = []
  const closes: Array<() => void> = []
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line.startsWith('{')) {
        try {
          const frame = JSON.parse(line) as HostFrame
          for (const l of frames) l(frame)
        } catch {
          log.warn('Ignored a malformed frame from a remote host')
        }
      }
      newline = buffer.indexOf('\n')
    }
  })
  child.stdin.on('error', () => undefined)
  child.once('close', () => closes.forEach((l) => l()))
  return {
    send: (frame) => {
      if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(frame)}\n`)
    },
    onFrame: (l) => void frames.push(l),
    onClose: (l) => void closes.push(l),
    close: () => void child.kill()
  }
}

type Spawn = (file: string, args: string[], env?: Record<string, string>) => ChildProcessWithoutNullStreams

/** How long a step may take when the user may be typing a password or code meanwhile. */
const WITH_USER_MS = 4 * 60_000

/** Connection reuse (OpenSSH ControlMaster) for the short commands; Windows' OpenSSH has none. */
const muxOptions = (platform: NodeJS.Platform): string[] =>
  platform === 'win32' ? [] : ['-o', 'ControlMaster=auto', '-o', 'ControlPath=/tmp/hiveory-ssh-%C', '-o', 'ControlPersist=60']

/** Wraps a fixed command for the login shell, whatever it is (sh, bash, zsh, fish): single quotes reach sh intact. */
const underSh = (command: string): string => {
  if (command.includes("'")) fail('UNEXPECTED', 'A remote command must not contain single quotes.')
  return `sh -c '${WITH_NODE}${command}'`
}

export interface DeployResult {
  info: RemoteInfo
  /** hiveoryd or its node-pty was (re)installed. */
  installed: boolean
  /** Hiveory's own Node was installed because the machine had none (or one too old). */
  nodeInstalled: boolean
}

/**
 * Reaches a machine over the user's own OpenSSH (ADR 0022, 0025): its config,
 * agent, jump hosts and known_hosts apply. Questions ssh asks (a password, a key
 * passphrase, a one-time code, a new host's fingerprint) are answered in
 * Hiveory's window through `auth`; without it, ssh runs in batch mode. On first
 * use it installs hiveoryd (one JS file plus node-pty) under
 * ~/.hiveory-host/v<protocol>, and Hiveory's own Node when the machine has
 * none, then speaks the same frames as the local host daemon.
 */
export class SshHostConnector {
  constructor(
    /** The built daemon (out/main/host.js). */
    private readonly bundlePath: string,
    private readonly log: Logger,
    /** Extra ssh options before the destination (tests point -F at their own config). */
    private readonly sshOptions: string[] = [],
    private readonly spawn: Spawn = (file, args, env) =>
      spawnProcess(file, args, { windowsHide: true, env: env ? { ...process.env, ...env } : process.env }) as ChildProcessWithoutNullStreams,
    private readonly auth?: SshAuth,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  /** What is on the other side: OS, CPU, home folder, Node version ('' when missing) and libc. */
  async probe(target: SshTarget): Promise<RemoteInfo> {
    return parseProbe(
      await this.run(
        target,
        'printf "%s\\n" "$(uname -s)" "$(uname -m)" "$HOME"; node -v 2>/dev/null || echo none; if [ "$(uname -s)" = Linux ]; then if ldd --version 2>&1 | grep -qi musl; then echo musl; else echo glibc; fi; fi'
      )
    )
  }

  /**
   * Makes the machine ready: Hiveory's own Node when it has no usable one, then
   * hiveoryd and node-pty when they are missing or out of date.
   */
  async deploy(target: SshTarget): Promise<DeployResult> {
    const bundle = readFileSync(this.bundlePath)
    // The remote has only node-pty: a bundle importing sibling chunks could never start there.
    if (/from\s*["']\.\.?\//.test(bundle.toString('utf8'))) fail('UNEXPECTED', 'The host daemon bundle is not standalone.', { operation: 'Install the host' })
    let info = await this.probe(target)
    let nodeInstalled = false
    if (!nodeUsable(info.node)) {
      info = { ...info, node: await this.installNode(target, info) }
      nodeInstalled = true
    }
    const sha = createHash('sha256').update(bundle).digest('hex')
    const state = await this.run(target, `cat ${REMOTE_DIR}/host.sha256 2>/dev/null; echo; test -d ${REMOTE_DIR}/node_modules/@lydell/node-pty && echo pty-ok || true`)
    let installed = false
    if (state.split(/\r?\n/)[0]?.trim() !== sha) {
      await this.run(target, `mkdir -p ${REMOTE_DIR} && cat > ${REMOTE_DIR}/host.mjs.tmp && mv ${REMOTE_DIR}/host.mjs.tmp ${REMOTE_DIR}/host.mjs && printf %s ${sha} > ${REMOTE_DIR}/host.sha256`, bundle)
      installed = true
    }
    if (!state.includes('pty-ok')) {
      await this.run(target, `cd ${REMOTE_DIR} && npm install --no-save --no-audit --no-fund --loglevel=error @lydell/node-pty@${NODE_PTY_VERSION}`, undefined, 5 * 60_000)
      installed = true
    }
    return { info, installed, nodeInstalled }
  }

  /** Installs Hiveory's own Node on the remote; returns its version. */
  private async installNode(target: SshTarget, info: RemoteInfo): Promise<string> {
    const build = managedNodeBuild(info)
    const needs = info.node ? `${target.destination} has Node ${info.node}; Hiveory needs ${MIN_REMOTE_NODE} or newer.` : `Node.js is not installed on ${target.destination}.`
    if (!build) {
      fail('NOT_FOUND', needs, {
        operation: 'Connect over SSH',
        hint: `Hiveory can install its own Node only on 64-bit Linux (glibc) and macOS. Install Node ${MIN_REMOTE_NODE} or newer there.`
      })
    }
    this.log.info(`Installing Hiveory's Node ${MANAGED_NODE} (${build}) on ${target.destination}`)
    const result = await this.exec(target, 'sh -s', Buffer.from(nodeInstallScript(build!)), 5 * 60_000)
    if (result.code === 0) return result.stdout.trim().split(/\r?\n/).pop()!.replace(/^v/, '')
    const why = /HIVEORY_NO_DOWNLOADER/.test(result.stderr)
      ? 'It needs curl or wget there to download Node.'
      : /HIVEORY_BAD_CHECKSUM/.test(result.stderr)
        ? 'The downloaded Node did not match its checksum, so it was not installed.'
        : /HIVEORY_NODE_WONT_RUN/.test(result.stderr)
          ? `Node ${MANAGED_NODE} does not run on that system (it may be too old).`
          : ''
    if (!why) explainSshFailure(target.destination, result.stderr || `exit code ${result.code}`)
    return fail('UNEXPECTED', `${needs} Installing Hiveory's own Node failed.`, { operation: 'Connect over SSH', hint: `${why} Or install Node ${MIN_REMOTE_NODE}+ there yourself.`, detail: result.stderr.trim() })
  }

  /**
   * Starts (or reattaches to) hiveoryd on the remote and returns a client once it has
   * answered hello. The daemon outlives the connection, so terminals survive a dropped
   * link (ADR 0025). With `tunnelPort`, a reverse tunnel lets agents there reach Hiveory's
   * hook server; `remotePort` asks for the same remote port as before (after a reconnect),
   * so agents started earlier keep reporting.
   */
  async connect(
    target: SshTarget,
    tunnelPort?: string,
    remotePort?: number
  ): Promise<{ client: HostClient; home: string; platform: string; remotePort?: number }> {
    try {
      return await this.open(target, tunnelPort, remotePort)
    } catch (error) {
      // The old remote port may still be held by the dropped session: take a new one.
      if (remotePort) return this.open(target, tunnelPort)
      throw error
    }
  }

  private async open(target: SshTarget, tunnelPort?: string, wanted?: number): Promise<{ client: HostClient; home: string; platform: string; remotePort?: number }> {
    const tunnel = tunnelPort && /^\d+$/.test(tunnelPort) ? ['-o', 'ExitOnForwardFailure=yes', '-R', `${wanted ?? 0}:127.0.0.1:${tunnelPort}`] : []
    const child = this.spawn('ssh', ['-T', ...tunnel, ...this.args(target), underSh(`cd ${REMOTE_DIR} && exec node host.mjs --attach`)], await this.env(target))
    let stderr = ''
    let remotePort = tunnel.length && wanted ? wanted : undefined
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-4000)
      const allocated = /Allocated port (\d+) for remote forward/.exec(d)
      if (allocated) remotePort = Number(allocated[1])
      else this.log.warn(`hiveoryd@${target.destination}: ${d.trim()}`)
    })
    const client = new HostClient(lineTransport(child, this.log), { keepPtys: true })
    let hello: Awaited<ReturnType<HostClient['call']>> & { home?: string; platform?: string; protocol?: number }
    try {
      // The user may be typing a password or code meanwhile.
      hello = await client.call('hello', { protocol: HOST_PROTOCOL }, this.auth ? WITH_USER_MS : 30_000)
      if (hello.protocol !== HOST_PROTOCOL) fail('UNEXPECTED', `The host on ${target.destination} speaks protocol ${hello.protocol}.`)
    } catch (error) {
      client.close()
      if (/Permission denied/i.test(stderr)) this.auth?.forget(target.destination)
      if (stderr) explainSshFailure(target.destination, stderr)
      throw error
    }
    return { client, home: hello.home ?? '', platform: hello.platform ?? 'linux', remotePort }
  }

  /**
   * A local loopback port that reaches `host:port` as seen from the remote machine (ssh -L),
   * e.g. a bot computer's desktop or a dev server on a VPS. `localPort` is tried first
   * (the same number as remotely reads best); otherwise any free one. Closed by `close()`.
   */
  async forward(target: SshTarget, host: string, port: number, localPort?: number): Promise<{ port: number; close(): void }> {
    if (!/^[A-Za-z0-9.:-]+$/.test(host) || !Number.isInteger(port)) fail('INVALID_INPUT', 'Invalid forward target.')
    const local = localPort && (await isFree(localPort)) ? localPort : await freePort()
    const child = this.spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${local}:${host}:${port}`, ...this.args(target)], await this.env(target))
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-4000)
      this.log.warn(`ssh forward ${target.destination}: ${d.trim()}`)
    })
    // Ready once the local port accepts connections; the user may be answering a question meanwhile.
    const until = Date.now() + (this.auth ? WITH_USER_MS : 6000)
    for (;;) {
      if (child.exitCode !== null) {
        if (stderr) explainSshFailure(target.destination, stderr)
        fail('UNEXPECTED', `Could not open a tunnel to ${target.destination}.`)
      }
      if (await accepts(local)) break
      if (Date.now() > until) {
        child.kill()
        fail('UNEXPECTED', `Could not open a tunnel to ${target.destination}.`)
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    return { port: local, close: () => void child.kill() }
  }

  private async env(target: SshTarget): Promise<Record<string, string> | undefined> {
    return this.auth ? this.auth.env(target.destination) : undefined
  }

  private args(target: SshTarget, mux = false): string[] {
    if (!isSafeDestination(target.destination)) fail('INVALID_INPUT', 'Use an SSH alias or user@host.')
    return [
      // Without a window to ask in, ssh must never wait for a terminal that is not there.
      ...(this.auth ? [] : ['-o', 'BatchMode=yes']),
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      ...(mux ? muxOptions(this.platform) : []),
      ...this.sshOptions,
      ...(target.port ? ['-p', String(target.port)] : []),
      '--',
      target.destination
    ]
  }

  /** Runs one fixed remote command (never user text) under sh and collects its result. */
  private exec(target: SshTarget, command: string, stdin?: Buffer, timeoutMs = this.auth ? WITH_USER_MS : 60_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const args = [...this.args(target, true), underSh(command)]
      void this.env(target).then((env) => {
        const child = this.spawn('ssh', args, env)
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => child.kill(), timeoutMs)
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (d: string) => (stdout += d))
        child.stderr.on('data', (d: string) => (stderr = (stderr + d).slice(-8000)))
        child.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code !== 0 && /Permission denied/i.test(stderr)) this.auth?.forget(target.destination)
          resolve({ code, stdout, stderr })
        })
        child.stdin.on('error', () => undefined)
        child.stdin.end(stdin)
      }, reject)
    })
  }

  /** Like exec, but a failure becomes an explained error. */
  private async run(target: SshTarget, command: string, stdin?: Buffer, timeoutMs?: number): Promise<string> {
    const result = await this.exec(target, command, stdin, timeoutMs)
    if (result.code === 0) return result.stdout
    return explainSshFailure(target.destination, result.stderr || `exit code ${result.code}`)
  }
}
