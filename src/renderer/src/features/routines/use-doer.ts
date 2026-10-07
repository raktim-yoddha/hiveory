import type { RoutineTarget } from '@shared/domain/routine'
import { useBots } from '../../stores/bots'
import { useClis, useProjects, useWorkspaces } from '../../stores/data'

/** Who does a routine or did a run, as the user reads it: a bot's name, "Codex · new chat" or "Claude Code · demo-app · main". */
export function useDoerName(): (r: { botId?: string; target?: RoutineTarget; where?: string }) => string {
  const bots = useBots((s) => s.bots)
  const clis = useClis((s) => s.clis)
  const projects = useProjects((s) => s.projects)
  const byProject = useWorkspaces((s) => s.byProject)
  return (r) => {
    if (r.botId) return bots.find((b) => b.id === r.botId)?.name ?? 'Deleted bot'
    if (!r.target) return r.where ?? 'Nobody'
    const cli = clis.find((c) => c.id === r.target!.cliId)?.displayName ?? r.target.cliId
    if (r.target.kind === 'chat') return `${cli} · new chat`
    const { projectId, workspaceId } = r.target
    const project = projects.find((p) => p.id === projectId)?.name ?? 'a workspace'
    const workspace = byProject[projectId]?.find((w) => w.id === workspaceId)?.name ?? 'a worktree'
    return `${cli} · ${project} · ${workspace}`
  }
}
