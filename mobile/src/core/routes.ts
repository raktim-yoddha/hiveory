/**
 * Where each screen lives. Features navigate with these instead of importing
 * routes (src/app composes features; a feature never reaches into it).
 */
export const routes = {
  inbox: '/' as const,
  projects: '/projects' as const,
  settings: '/settings' as const,
  /** Schedules, one Workspace's or all of them (ADR 0053, 0056). */
  schedules: (projectId?: string) => ({ pathname: '/schedules' as const, params: projectId ? { projectId } : {} }),
  /** A new Schedule (in a Workspace, when known), or one to edit. */
  schedule: (routineId?: string, projectId?: string) => ({ pathname: '/schedule' as const, params: { ...(routineId ? { routineId } : {}), ...(projectId ? { projectId } : {}) } }),
  /** A folder of a worktree ('' = its top), and one file in it (ADR 0053). */
  files: (workspaceId: string, projectId: string, dir = '') => ({ pathname: '/files/[workspaceId]' as const, params: { workspaceId, projectId, dir } }),
  file: (workspaceId: string, projectId: string, path: string) => ({ pathname: '/file/[workspaceId]' as const, params: { workspaceId, projectId, path } }),
  /** A worktree's changes: diffs, commit, push, discard (ADR 0060). */
  changes: (workspaceId: string) => ({ pathname: '/changes/[workspaceId]' as const, params: { workspaceId } }),
  /** Tokens the computer's agents used (ADR 0060). */
  usage: '/usage' as const,
  pair: '/pair' as const,
  project: (projectId: string) => ({ pathname: '/project/[projectId]' as const, params: { projectId } }),
  projectSettings: (projectId: string) => ({ pathname: '/project-settings/[projectId]' as const, params: { projectId } }),
  pullRequests: (projectId: string) => ({ pathname: '/pull-requests/[projectId]' as const, params: { projectId } }),
  workspace: (workspaceId: string, projectId: string) => ({ pathname: '/workspace/[workspaceId]' as const, params: { workspaceId, projectId } }),
  agent: (instanceId: string, workspaceId: string, projectId: string) => ({ pathname: '/agent/[instanceId]' as const, params: { instanceId, workspaceId, projectId } })
}
