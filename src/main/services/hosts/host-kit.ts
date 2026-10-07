import { existsSync, mkdirSync, statSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, posix, win32 } from 'node:path'
import { hostKey, hostLabel, type HostLinkStatus, type HostRef } from '@shared/domain'
import type { ExecParams, HostService } from '@shared/host/protocol'
import { runProgram } from '../../../host/host-server'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import type { CliAdapter } from '../cli/adapters'
import type { HookEndpoint } from '../cli/adapters/types'
import { CliRegistry } from '../cli/registry'
import type { FileService } from '../files/file-service'
import type { GitService } from '../git/git-service'
import type { WorktreeService } from '../git/worktree-service'
import type { PtyBackend } from '../pty/pty-backend'
import { hostPtyBackend } from './host-client'
import type { HostClient } from './host-client'
import type { SshHostConnector } from './ssh-host'

/** Every method of T, returning a promise (a remote service is always async). */
export type Remote<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never }

export interface HostFs {
  exists(path: string): Promise<boolean>
  isDirectory(path: string): Promise<boolean>
  mkdirp(path: string): Promise<void>
  readDir(path: string): Promise<Array<{ name: string; dir: boolean }>>
  writeText(path: string, content: string): Promise<void>
}

/**
 * Everything a project needs from the machine it lives on (ADR 0022): git,
 * worktrees, files, PTYs, its installed CLIs, path rules and where agents
 * report status. Work services ask for the kit of a project's host and never
 * care whether it is this computer or a server reached over SSH.
 */
export interface HostKit {
  key: string
  remote: boolean
  label: string
  paths: typeof posix
  home: string
  git: Remote<Pick<GitService, 'repositoryRoot' | 'currentBranch' | 'hasCommits' | 'localBranchExists' | 'refExists' | 'localBranches' | 'status' | 'branchNameProblem' | 'init' | 'defaultBranch'>>
  worktrees: Remote<Pick<WorktreeService, 'create' | 'remove' | 'deleteBranchIfMerged' | 'repairLink' | 'list' | 'prune' | 'recreate'>>
  files: Remote<Pick<FileService, 'list' | 'search' | 'read' | 'write' | 'create' | 'rename' | 'remove' | 'paste' | 'watch' | 'resolveIn'>>
  fs: HostFs
  pty: PtyBackend
  registry: CliRegistry
  /** Runs a program on this machine without a shell (docker for bot computers, for example). */
  exec(params: ExecParams): Promise<{ code: number | null; stdout: string; stderr: string }>
  /** Reaches `host:port` as seen from this machine through a local loopback port (identity locally; `localPort` is preferred remotely). */
  forward(host: string, port: number, localPort?: number): Promise<{ port: number; close(): void }>
  /** Where agents on this host post status hooks and reach Hiveory's tools. */
  hook(): HookEndpoint | undefined
  /** Root of isolated workspaces on this host. */
  worktreeRoot: string
  /** Per-agent generated files on this host. */
  runtimeRoot: string
}

const localFs: HostFs = {
  exists: async (path) => existsSync(path),
  isDirectory: async (path) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  mkdirp: async (path) => void mkdirSync(path, { recursive: true }),
  readDir: async (path) => (await readdir(path, { withFileTypes: true }).catch(() => [])).map((d) => ({ name: d.name, dir: d.isDirectory() })),
  writeText: async (path, content) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
}

/** Promise-returning view of a local service (local methods may be sync). */
const asRemote = <T extends object>(service: T): Remote<T> =>
  new Proxy(service, {
    get: (target, key) => {
      const value = (target as Record<PropertyKey, unknown>)[key]
      return typeof value === 'function' ? (...args: unknown[]) => Promise.resolve().then(() => (value as (...a: unknown[]) => unknown).apply(target, args)) : value
    }
  }) as unknown as Remote<T>

export interface LocalKitParts {
  git: GitService
  worktrees: WorktreeService
  files: FileService
  pty: PtyBackend
  registry: CliRegistry
  hook: () => HookEndpoint | undefined
  worktreeRoot: string
  runtimeRoot: string
  home: string
}

export const localKit = (parts: LocalKitParts): HostKit => ({
  key: 'local',
  remote: false,
  label: hostLabel(),
  paths: (process.platform === 'win32' ? win32 : posix) as typeof posix,
  home: parts.home,
  git: asRemote(parts.git),
  worktrees: asRemote(parts.worktrees),
  files: asRemote(parts.files),
  fs: localFs,
  pty: parts.pty,
  registry: parts.registry,
  exec: runProgram,
  forward: async (_host, port) => ({ port, close: () => undefined }),
  hook: parts.hook,
  worktreeRoot: parts.worktreeRoot,
  runtimeRoot: parts.runtimeRoot
})

/** How long a dropped host is retried while its daemon keeps the terminals (as long as the daemon keeps them). */
export const RECONNECT_GRACE_MS = 5 * 60_000
const FIRST_RETRY_MS = 1000
const MAX_RETRY_MS = 15_000

interface Connection {
  kit: Promise<HostKit>
  /** The live link: a reconnect swaps the client under the same kit. */
  link?: { client: HostClient; remotePort?: number }
  status: HostLinkStatus
}

/**
 * The kits for this computer and every SSH host projects live on. A remote kit
 * connects on first use (installing hiveoryd if needed) and opens a reverse
 * tunnel so agents there can reach Hiveory's hooks and tools. When the link
 * drops, the daemon keeps that machine's terminals and Hiveory reconnects with
 * backoff for RECONNECT_GRACE_MS, handing every terminal to the new link (ADR
 * 0025). Only after that do its agents stop. A failed connection fails only
 * that host's work.
 */
export class HostRegistry {
  private readonly connections = new Map<string, Connection>()
  private closing = false

  constructor(
    private readonly local: HostKit,
    private readonly ssh: SshHostConnector,
    private readonly adapters: CliAdapter[],
    private readonly log: Logger,
    /** The local hook server's endpoint, to tunnel to remote agents. */
    private readonly localHook: () => HookEndpoint | undefined,
    private readonly onFilesChanged: (scope: string, paths: string[]) => void,
    /** The link to a host changed (connecting, connected, reconnecting, offline). */
    private readonly onStatus: (host: HostRef, status: HostLinkStatus) => void
  ) {}

  localKit(): HostKit {
    return this.local
  }

  /** The kit for a project's machine (connecting to it when needed). */
  kit(host?: HostRef): Promise<HostKit> {
    if (!host) return Promise.resolve(this.local)
    const key = hostKey(host)
    const existing = this.connections.get(key)
    // While reconnecting, the same kit stays: its calls fail fast until the link is back.
    if (existing && existing.status !== 'offline') return existing.kit
    const connection: Connection = { kit: Promise.resolve(this.local), status: 'connecting' }
    this.connections.set(key, connection)
    this.onStatus(host, 'connecting')
    connection.kit = this.connect(host, connection).then(
      (kit) => {
        this.setStatus(host, connection, 'connected')
        return kit
      },
      (error: unknown) => {
        this.connections.delete(key)
        this.onStatus(host, 'offline')
        throw error
      }
    )
    return connection.kit
  }

  /** Whether that host is connected right now (for sync paths such as listing CLIs). */
  connected(host?: HostRef): boolean {
    if (!host) return true
    return Boolean(this.connections.get(hostKey(host))?.link?.client.alive)
  }

  /** Every remote host Hiveory has a link to (or is getting one), by host key. */
  statuses(): Record<string, HostLinkStatus> {
    return Object.fromEntries([...this.connections].map(([key, c]) => [key, c.status]))
  }

  closeAll(): void {
    this.closing = true
    for (const c of this.connections.values()) c.link?.client.close()
    this.connections.clear()
  }

  private setStatus(host: HostRef, connection: Connection, status: HostLinkStatus): void {
    if (connection.status === status) return
    connection.status = status
    this.onStatus(host, status)
  }

  private hookPort(): string | undefined {
    const hook = this.localHook()
    return hook ? new URL(hook.baseUrl).port : undefined
  }

  private watch(host: HostRef, connection: Connection, client: HostClient): void {
    client.onFilesChanged(({ scope, paths: changed }) => this.onFilesChanged(scope, changed))
    client.onClosed(() => {
      if (this.closing || connection.link?.client !== client) return
      this.log.warn(`Lost the connection to ${host.destination}; reconnecting`)
      void this.reconnect(host, connection, client)
    })
  }

  /** Brings a dropped link back and hands it the kept terminals, or gives up after the grace period. */
  private async reconnect(host: HostRef, connection: Connection, dead: HostClient): Promise<void> {
    this.setStatus(host, connection, 'reconnecting')
    const target = { destination: host.destination, port: host.port }
    const until = Date.now() + RECONNECT_GRACE_MS
    let delay = FIRST_RETRY_MS
    while (!this.closing && Date.now() < until && this.connections.get(hostKey(host)) === connection) {
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(MAX_RETRY_MS, delay * 2)
      try {
        const { client, remotePort } = await this.ssh.connect(target, this.hookPort(), connection.link?.remotePort)
        if (remotePort !== connection.link?.remotePort) this.log.warn(`${host.destination}: hooks moved to remote port ${remotePort}; agents started before keep their old one`)
        connection.link = { client, remotePort }
        this.watch(host, connection, client)
        await client.adopt(dead)
        this.log.info(`Reconnected to ${host.destination}`)
        this.setStatus(host, connection, 'connected')
        return
      } catch (error) {
        this.log.warn(`Reconnecting to ${host.destination} failed`, error)
      }
    }
    dead.abandon()
    if (this.connections.get(hostKey(host)) === connection) this.connections.delete(hostKey(host))
    this.setStatus(host, connection, 'offline')
  }

  private async connect(host: HostRef, connection: Connection): Promise<HostKit> {
    const target = { destination: host.destination, port: host.port }
    await this.ssh.deploy(target)
    const hook = this.localHook()
    const { client, home, platform, remotePort } = await this.ssh.connect(target, this.hookPort())
    const link = { client, remotePort }
    connection.link = link
    this.watch(host, connection, client)
    const paths = (platform === 'win32' ? win32 : posix) as typeof posix
    const names = [...new Set(this.adapters.flatMap((a) => a.executables))]
    const found = await client.call('which', { names })
    const family = platform === 'win32' ? 'win32' : 'posix'
    const registry = new CliRegistry(this.adapters, this.log, () => ({ platform: platform as NodeJS.Platform, path: '' }), (adapter) =>
      adapter.platforms && !adapter.platforms.includes(family) ? undefined : adapter.executables.map((n) => found[n]).find(Boolean)
    )
    this.log.info(`Connected to ${host.destination} (${platform}, hooks ${remotePort ? `on remote port ${remotePort}` : 'off'})`)
    // Every call goes through whichever client is live now, so a reconnect is invisible to callers.
    const live = () => connection.link!.client
    const service = <T extends object>(name: HostService): T =>
      new Proxy({} as T, {
        get: (_target, method) =>
          typeof method === 'string' && method !== 'then' ? (...args: unknown[]) => live().call('invoke', { service: name, method, args }, 120_000) : undefined
      })
    return {
      key: hostKey(host),
      remote: true,
      label: hostLabel(host),
      paths,
      home,
      git: service('git'),
      worktrees: service('worktrees'),
      files: service('files'),
      fs: service('fs'),
      // Remote PTYs never fall back to this computer: the work belongs on that host.
      pty: hostPtyBackend(() => Promise.resolve(live().alive ? live() : null), {
        spawn: () => fail('NOT_FOUND', `${host.destination} is not connected.`)
      }),
      registry,
      exec: (params) => live().call('exec', params, (params.timeoutMs ?? 60_000) + 10_000),
      forward: (to, port, localPort) => this.ssh.forward(target, to, port, localPort),
      hook: () => {
        const port = connection.link?.remotePort
        return hook && port ? { baseUrl: `http://127.0.0.1:${port}`, token: hook.token } : undefined
      },
      worktreeRoot: paths.join(home, '.hiveory', 'workspaces'),
      runtimeRoot: paths.join(home, '.hiveory-host', 'runtime')
    }
  }
}

/** A KitSource for this computer only (tests and tools that never touch remote hosts). */
export const localKitSource = (git: GitService, worktrees: WorktreeService, worktreeRoot: string, files?: FileService) => {
  const kit = localKit({
    git,
    worktrees,
    files: files ?? (new Proxy({}, { get: () => () => fail('UNEXPECTED', 'No file service here.') }) as FileService),
    pty: { spawn: () => fail('UNEXPECTED', 'No terminals here.') },
    registry: new CliRegistry([], { info: () => undefined, warn: () => undefined, error: () => undefined }),
    hook: () => undefined,
    worktreeRoot,
    runtimeRoot: worktreeRoot,
    home: worktreeRoot
  })
  return { kit: async () => kit }
}
