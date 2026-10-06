/** Where a project's files, git and agents live (ADR 0022). Absent = this computer. */
export interface HostRef {
  kind: 'ssh'
  /** An alias from ~/.ssh/config or user@host. */
  destination: string
  port?: number
}

/** One stable key per machine: 'local', or 'ssh:<destination>[:port]'. */
export const hostKey = (host?: HostRef): string => (host ? `ssh:${host.destination}${host.port ? `:${host.port}` : ''}` : 'local')

/** How a host is named to the user. */
export const hostLabel = (host?: HostRef): string => (host ? host.destination : 'This computer')

export interface Project {
  id: string
  name: string
  /** Folder the user opened (on `host` when the project is remote). */
  path: string
  /** A remote machine reached over SSH; absent for projects on this computer. */
  host?: HostRef
  /** Git repository root, when the folder belongs to a repository. */
  repositoryRoot?: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
  /** Last real work here — an agent started a turn, an agent or workspace was created — for the sidebar order. */
  lastActiveAt?: string
}

export type ProjectSort = 'recent' | 'name'

/** Hiveory workspace folders on disk that no project knows, grouped by their repository. */
export interface FoundWorktrees {
  repoRoot: string
  name: string
  /** Folder names (the workspaces' names). */
  workspaces: string[]
}

/**
 * Something Add project › Restore previous can bring back: a removed project
 * (whole, with its agents), or workspace folders found on disk. `projectId` is
 * set when that repository is open as a project right now.
 */
export interface PreviousProject {
  source: 'removed' | 'found'
  name: string
  path: string
  workspaces: string[]
  agents: number
  removedAt?: string
  /** The folder is gone: nothing to restore into. */
  missing: boolean
  projectId?: string
}
