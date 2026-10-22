/**
 * Where each screen lives. Features navigate with these instead of importing
 * routes (src/app composes features; a feature never reaches into it).
 */
export const routes = {
  inbox: '/' as const,
  projects: '/projects' as const,
  settings: '/settings' as const,
  bots: '/bots' as const,
  schedules: '/schedules' as const,
  /** A new Schedule, or one to edit (ADR 0053). */
  schedule: (routineId?: string) => ({ pathname: '/schedule' as const, params: routineId ? { routineId } : {} }),
  triggers: '/triggers' as const,
  teams: '/teams' as const,
  /** A new bot, or one to edit. */
  botEdit: (botId?: string) => ({ pathname: '/bot-edit' as const, params: botId ? { botId } : {} }),
  /** A folder of a worktree ('' = its top), and one file in it (ADR 0053). */
  files: (workspaceId: string, projectId: string, dir = '') => ({ pathname: '/files/[workspaceId]' as const, params: { workspaceId, projectId, dir } }),
  file: (workspaceId: string, projectId: string, path: string) => ({ pathname: '/file/[workspaceId]' as const, params: { workspaceId, projectId, path } }),
  chats: '/chat' as const,
  chat: (chatId: string) => ({ pathname: '/chat/[chatId]' as const, params: { chatId } }),
  bot: (botId: string) => ({ pathname: '/bot/[botId]' as const, params: { botId } }),
  pair: '/pair' as const,
  project: (projectId: string) => ({ pathname: '/project/[projectId]' as const, params: { projectId } }),
  projectSettings: (projectId: string) => ({ pathname: '/project-settings/[projectId]' as const, params: { projectId } }),
  pullRequests: (projectId: string) => ({ pathname: '/pull-requests/[projectId]' as const, params: { projectId } }),
  workspace: (workspaceId: string, projectId: string) => ({ pathname: '/workspace/[workspaceId]' as const, params: { workspaceId, projectId } }),
  agent: (instanceId: string, workspaceId: string, projectId: string) => ({ pathname: '/agent/[instanceId]' as const, params: { instanceId, workspaceId, projectId } })
}
