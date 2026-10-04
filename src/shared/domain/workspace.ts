export type WorkspaceKind = 'main' | 'isolated'

export interface WorkspaceAssociation {
  kind: 'issue' | 'pull-request'
  ref: string
}

export interface Workspace {
  id: string
  projectId: string
  name: string
  kind: WorkspaceKind
  /** Directory CLI agents run in. */
  path: string
  git?: {
    /** Linked worktree directory (isolated Workspaces only). */
    worktreePath?: string
    branch?: string
    baseRef?: string
  }
  association?: WorkspaceAssociation
  /** Default auto-approve setting applied to agents opened in this Workspace. */
  autoApprove: boolean
  createdAt: string
  updatedAt: string
}

/** Workspace as returned to the UI, with derived state. */
export interface WorkspaceView extends Workspace {
  /** False when the backing directory no longer exists on disk. */
  healthy: boolean
  agentCount: number
}

/** Id of a Project's main Workspace. Deterministic: a Project has at most one, created by the user (ADR 0011). */
export const mainWorkspaceId = (projectId: string): string => `${projectId}--main`
