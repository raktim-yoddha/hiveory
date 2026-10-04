import type { CliInstance, CliRuntimeDetails, KanbanBoard } from '@shared/domain'

/**
 * Groups a Project's instances into the three status columns. Callers pass
 * instances already queried by project; the filter here is a second guard so
 * another Project's agent can never appear (AGENTS.md rule 8).
 */
export const buildBoard = (
  projectId: string,
  instances: CliInstance[],
  workspaceName: (workspaceId: string) => string | undefined,
  runtime: (instanceId: string) => CliRuntimeDetails
): KanbanBoard => {
  const board: KanbanBoard = { idle: [], working: [], 'waiting-for-you': [] }
  for (const instance of instances) {
    if (instance.projectId !== projectId) continue
    const name = workspaceName(instance.workspaceId)
    if (name === undefined) continue
    const details = runtime(instance.id)
    board[details.status].push({
      instanceId: instance.id,
      cliId: instance.cliId,
      petName: instance.petName,
      workspaceId: instance.workspaceId,
      workspaceName: name,
      runtime: details
    })
  }
  return board
}
