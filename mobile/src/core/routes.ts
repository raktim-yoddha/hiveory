/**
 * Where each screen lives. Features navigate with these instead of importing
 * routes (src/app composes features; a feature never reaches into it).
 */
export const routes = {
  inbox: '/' as const,
  projects: '/projects' as const,
  settings: '/settings' as const,
  pair: '/pair' as const,
  project: (projectId: string) => ({ pathname: '/project/[projectId]' as const, params: { projectId } }),
  projectSettings: (projectId: string) => ({ pathname: '/project-settings/[projectId]' as const, params: { projectId } }),
  pullRequests: (projectId: string) => ({ pathname: '/pull-requests/[projectId]' as const, params: { projectId } }),
  workspace: (workspaceId: string, projectId: string) => ({ pathname: '/workspace/[workspaceId]' as const, params: { workspaceId, projectId } }),
  agent: (instanceId: string, workspaceId: string, projectId: string) => ({ pathname: '/agent/[instanceId]' as const, params: { instanceId, workspaceId, projectId } })
}
