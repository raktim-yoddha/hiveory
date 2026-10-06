import { existsSync, mkdirSync, statSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, posix, win32 } from 'node:path'
import { hostKey, hostLabel, type HostRef } from '@shared/domain'
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
  hook: parts.hook,
  worktreeRoot: parts.worktreeRoot,
  runtimeRoot: parts.runtimeRoot
})

interface Connection {
  kit: Promise<HostKit>
  client?: HostClient
}

/**
 * The kits for this computer and every SSH host projects live on. A remote kit
 * connects on first use (installing hiveoryd if needed), opens a reverse tunnel
 * so agents there can reach Hiveory's hooks and tools, and reconnects on the
 * next use after the link drops. A failed connection fails only that host's work.
 */
export class HostRegistry {
  private readonly connections = new Map<string, Connection>()

  constructor(
    private readonly local: HostKit,
    private readonly ssh: SshHostConnector,
    private readonly adapters: CliAdapter[],
    private readonly log: Logger,
    /** The local hook server's endpoint, to tunnel to remote agents. */
    private readonly localHook: () => HookEndpoint | undefined,
    private readonly onFilesChanged: (scope: string, paths: string[]) => void,
    private readonly onDisconnected: (host: HostRef) => void
  ) {}

  localKit(): HostKit {
    return this.local
  }

  /** The kit for a project's machine (connecting to it when needed). */
  kit(host?: HostRef): Promise<HostKit> {
    if (!host) return Promise.resolve(this.local)
    const key = hostKey(host)
    const existing = this.connections.get(key)
    if (existing && (!existing.client || existing.client.alive)) return existing.kit
    const connection: Connection = { kit: Promise.resolve(this.local) }
    connection.kit = this.connect(host, connection).catch((error: unknown) => {
      this.connections.delete(key)
      throw error
    })
    this.connections.set(key, connection)
    return connection.kit
  }

  /** The kit if that host is connected right now (for sync paths such as listing CLIs). */
  connected(host?: HostRef): boolean {
    if (!host) return true
    return Boolean(this.connections.get(hostKey(host))?.client?.alive)
  }

  closeAll(): void {
    for (const c of this.connections.values()) c.client?.close()
    this.connections.clear()
  }

  private async connect(host: HostRef, connection: Connection): Promise<HostKit> {
    const target = { destination: host.destination, port: host.port }
    await this.ssh.deploy(target)
    const hook = this.localHook()
    const { client, home, platform, remotePort } = await this.ssh.connect(target, hook ? new URL(hook.baseUrl).port : undefined)
    connection.client = client
    const paths = (platform === 'win32' ? win32 : posix) as typeof posix
    const names = [...new Set(this.adapters.flatMap((a) => a.executables))]
    const found = await client.call('which', { names })
    const family = platform === 'win32' ? 'win32' : 'posix'
    const registry = new CliRegistry(this.adapters, this.log, () => ({ platform: platform as NodeJS.Platform, path: '' }), (adapter) =>
      adapter.platforms && !adapter.platforms.includes(family) ? undefined : adapter.executables.map((n) => found[n]).find(Boolean)
    )
    client.onFilesChanged(({ scope, paths: changed }) => this.onFilesChanged(scope, changed))
    client.onClosed(() => {
      this.log.warn(`Lost the connection to ${host.destination}`)
      this.onDisconnected(host)
    })
    this.log.info(`Connected to ${host.destination} (${platform}, hooks ${remotePort ? `on remote port ${remotePort}` : 'off'})`)
    return {
      key: hostKey(host),
      remote: true,
      label: hostLabel(host),
      paths,
      home,
      git: client.service('git'),
      worktrees: client.service('worktrees'),
      files: client.service('files'),
      fs: client.service('fs'),
      // Remote PTYs never fall back to this computer: the work belongs on that host.
      pty: hostPtyBackend(() => Promise.resolve(client.alive ? client : null), {
        spawn: () => fail('NOT_FOUND', `${host.destination} is not connected.`)
      }),
      registry,
      hook: () => (hook && remotePort ? { baseUrl: `http://127.0.0.1:${remotePort}`, token: hook.token } : undefined),
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
