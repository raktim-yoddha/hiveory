import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { fail } from '@shared/errors'
import { HOST_PROTOCOL, type HostFrame, type HostTransport } from '@shared/host/protocol'
import type { Logger } from '../../app/logger'
import { HostClient } from './host-client'

/** The node-pty build the remote daemon installs; kept equal to package.json (a test checks). */
export const NODE_PTY_VERSION = '1.2.0-beta.15'
/** The remote daemon needs a Node with stable ESM and fetch. */
export const MIN_REMOTE_NODE = 20
/** Where hiveoryd lives on a remote machine, relative to the login's home; one folder per protocol. */
export const REMOTE_DIR = `.hiveory-host/v${HOST_PROTOCOL}`

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
}

/** An SSH destination we pass to ssh: never an option, never shell syntax. */
const DESTINATION = /^[A-Za-z0-9_][A-Za-z0-9._-]*(@[A-Za-z0-9_][A-Za-z0-9._-]*)?$/
export const isSafeDestination = (destination: string): boolean => DESTINATION.test(destination) && destination.length <= 255

/** Reads the probe's four lines: kernel, machine, home, node version (or "none"). */
export const parseProbe = (stdout: string): RemoteInfo => {
  const [kernel = '', machine = '', home = '', node = ''] = stdout.trim().split(/\r?\n/).map((l) => l.trim())
  return { platform: kernel.toLowerCase(), arch: machine, home, node: node === 'none' ? '' : node.replace(/^v/, '') }
}

/** Turns ssh's own failure text into a message with the next step; Hiveory never prompts for passwords. */
export const explainSshFailure = (destination: string, stderr: string): never => {
  const text = stderr.trim()
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No .* host key is known/i.test(text)) {
    fail('FORBIDDEN', `${destination}'s host key is not trusted.`, {
      operation: 'Connect over SSH',
      hint: `Connect once in a terminal (ssh ${destination}) and check its fingerprint. Hiveory never accepts host keys on its own.`,
      detail: text
    })
  }
  if (/Permission denied|Too many authentication failures/i.test(text)) {
    fail('FORBIDDEN', `${destination} refused the login.`, {
      operation: 'Connect over SSH',
      hint: 'Use key login (ssh-agent, or IdentityFile in ~/.ssh/config). Hiveory never asks for passwords.',
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

type Spawn = (file: string, args: string[]) => ChildProcessWithoutNullStreams

/**
 * Reaches a machine over the user's own OpenSSH (ADR 0022): its config, agent,
 * jump hosts and known_hosts apply, BatchMode means it never prompts, and host
 * keys are never accepted on Hiveory's own. On first use it installs hiveoryd
 * (one JS file plus node-pty) under ~/.hiveory-host/v<protocol>, then speaks the
 * same frames as the local host daemon — so remote Work and remote Bots share it.
 */
export class SshHostConnector {
  constructor(
    /** The built daemon (out/main/host.js). */
    private readonly bundlePath: string,
    private readonly log: Logger,
    /** Extra ssh options before the destination (tests point -F at their own config). */
    private readonly sshOptions: string[] = [],
    private readonly spawn: Spawn = (file, args) => spawnProcess(file, args, { windowsHide: true }) as ChildProcessWithoutNullStreams
  ) {}

  /** What is on the other side: OS, CPU, home folder and Node version. */
  async probe(target: SshTarget): Promise<RemoteInfo> {
    const out = await this.run(target, `printf '%s\\n' "$(uname -s)" "$(uname -m)" "$HOME"; node -v 2>/dev/null || echo none`)
    const info = parseProbe(out)
    if (!info.node) {
      fail('NOT_FOUND', `Node.js is not installed on ${target.destination}.`, { operation: 'Connect over SSH', hint: `Install Node ${MIN_REMOTE_NODE} or newer there (for its login shell).` })
    }
    if (Number(info.node.split('.')[0]) < MIN_REMOTE_NODE) {
      fail('INVALID_INPUT', `${target.destination} has Node ${info.node}; Hiveory needs ${MIN_REMOTE_NODE} or newer.`, { operation: 'Connect over SSH' })
    }
    return info
  }

  /** Installs or updates hiveoryd on the remote. Returns true when something had to be installed. */
  async deploy(target: SshTarget): Promise<boolean> {
    const bundle = readFileSync(this.bundlePath)
    // The remote has only node-pty: a bundle importing sibling chunks could never start there.
    if (/from\s*["']\.\.?\//.test(bundle.toString('utf8'))) fail('UNEXPECTED', 'The host daemon bundle is not standalone.', { operation: 'Install the host' })
    const sha = createHash('sha256').update(bundle).digest('hex')
    const state = await this.run(target, `cat ${REMOTE_DIR}/host.sha256 2>/dev/null; echo; test -d ${REMOTE_DIR}/node_modules/@lydell/node-pty && echo pty-ok || true`)
    let installed = false
    if (state.split(/\r?\n/)[0]?.trim() !== sha) {
      await this.run(target, `mkdir -p ${REMOTE_DIR} && cat > ${REMOTE_DIR}/host.mjs.tmp && mv ${REMOTE_DIR}/host.mjs.tmp ${REMOTE_DIR}/host.mjs && printf %s ${sha} > ${REMOTE_DIR}/host.sha256`, bundle)
      installed = true
    }
    if (!state.includes('pty-ok')) {
      await this.run(
        target,
        `cd ${REMOTE_DIR} && npm install --no-save --no-audit --no-fund --loglevel=error @lydell/node-pty@${NODE_PTY_VERSION}`,
        undefined,
        5 * 60_000
      )
      installed = true
    }
    return installed
  }

  /**
   * Starts hiveoryd on the remote and returns a client once it has answered hello.
   * With `tunnelPort`, a reverse tunnel lets agents there reach Hiveory's hook server
   * (loopback on both ends); `remotePort` is where it listens on the remote.
   */
  async connect(target: SshTarget, tunnelPort?: string): Promise<{ client: HostClient; home: string; platform: string; remotePort?: number }> {
    const tunnel = tunnelPort && /^\d+$/.test(tunnelPort) ? ['-o', 'ExitOnForwardFailure=yes', '-R', `0:127.0.0.1:${tunnelPort}`] : []
    const child = this.spawn('ssh', ['-T', ...tunnel, ...this.args(target), `cd ${REMOTE_DIR} && exec node host.mjs`])
    let stderr = ''
    let remotePort: number | undefined
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-4000)
      const allocated = /Allocated port (\d+) for remote forward/.exec(d)
      if (allocated) remotePort = Number(allocated[1])
      else this.log.warn(`hiveoryd@${target.destination}: ${d.trim()}`)
    })
    const client = new HostClient(lineTransport(child, this.log))
    let hello: Awaited<ReturnType<HostClient['call']>> & { home?: string; platform?: string; protocol?: number }
    try {
      hello = await client.call('hello', { protocol: HOST_PROTOCOL }, 30_000)
      if (hello.protocol !== HOST_PROTOCOL) fail('UNEXPECTED', `The host on ${target.destination} speaks protocol ${hello.protocol}.`)
    } catch (error) {
      client.close()
      if (stderr) explainSshFailure(target.destination, stderr)
      throw error
    }
    return { client, home: hello.home ?? '', platform: hello.platform ?? 'linux', remotePort }
  }

  /**
   * A local loopback port that reaches `host:port` as seen from the remote machine (ssh -L),
   * e.g. a bot computer's desktop on a VPS. Closed by `close()` or when Hiveory quits.
   */
  async forward(target: SshTarget, host: string, port: number): Promise<{ port: number; close(): void }> {
    if (!/^[A-Za-z0-9.:-]+$/.test(host) || !Number.isInteger(port)) fail('INVALID_INPUT', 'Invalid forward target.')
    const local = await freePort()
    const child = this.spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${local}:${host}:${port}`, ...this.args(target)])
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => this.log.warn(`ssh forward ${target.destination}: ${d.trim()}`))
    // Ready once the local port accepts connections (or give up after a few seconds).
    for (let i = 0; i < 40; i++) {
      if (child.exitCode !== null) fail('UNEXPECTED', `Could not open a tunnel to ${target.destination}.`)
      if (await accepts(local)) break
      await new Promise((r) => setTimeout(r, 150))
    }
    return { port: local, close: () => void child.kill() }
  }

  private args(target: SshTarget): string[] {
    if (!isSafeDestination(target.destination)) fail('INVALID_INPUT', 'Use an SSH alias or user@host.')
    return [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      ...this.sshOptions,
      ...(target.port ? ['-p', String(target.port)] : []),
      '--',
      target.destination
    ]
  }

  /** Runs one fixed remote command (never user text) and returns its stdout. */
  private run(target: SshTarget, command: string, stdin?: Buffer, timeoutMs = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = this.spawn('ssh', [...this.args(target), command])
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
        if (code === 0) return resolve(stdout)
        try {
          explainSshFailure(target.destination, stderr || `exit code ${code}`)
        } catch (error) {
          reject(error)
        }
      })
      child.stdin.on('error', () => undefined)
      child.stdin.end(stdin)
    })
  }
}
