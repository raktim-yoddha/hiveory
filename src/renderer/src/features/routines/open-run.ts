import { useRoutineEditor } from './RoutineEditor'

/** "Schedule a routine…" in Work (ADR 0040): the editor opens right here, for that Workspace's worktree. */
export function scheduleWorkRoutine(projectId: string, workspaceId: string): void {
  useRoutineEditor.getState().open({ target: { kind: 'workspace', projectId, workspaceId, cliId: '' } })
}
