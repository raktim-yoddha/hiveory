export interface Project {
  id: string
  name: string
  /** Folder the user opened. */
  path: string
  /** Git repository root, when the folder belongs to a repository. */
  repositoryRoot?: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
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
