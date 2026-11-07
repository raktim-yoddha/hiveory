import type { RoutineTarget } from '@shared/domain/routine'
import { useClis, useProjects, useWorkspaces } from '../../stores/data'

/** Who does a routine or did a run, as the user reads it: "Claude Code · demo-app · main". */
export function useDoerName(): (r: { target?: RoutineTarget; where?: string }) => string {
  const clis = useClis((s) => s.clis)
  const projects = useProjects((s) => s.projects)
  const byProject = useWorkspaces((s) => s.byProject)
  return (r) => {
    if (!r.target) return r.where ?? 'Nobody'
    const cli = clis.find((c) => c.id === r.target!.cliId)?.displayName ?? r.target.cliId
    const { projectId, workspaceId } = r.target
    const project = projects.find((p) => p.id === projectId)?.name ?? 'a workspace'
    const workspace = byProject[projectId]?.find((w) => w.id === workspaceId)?.name ?? 'a worktree'
    return `${cli} · ${project} · ${workspace}`
  }
}
