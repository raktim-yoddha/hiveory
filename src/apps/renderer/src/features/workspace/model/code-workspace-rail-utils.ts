import type { CodeWorkspaceSummary } from '../../../shared/api/hiveory-client'

export function shouldShowProjectWorkspaceRows(workspaceCount: number): boolean {
  return workspaceCount > 1
}

/**
 * Returns safe parent candidates for a secondary workspace. A parent is kept
 * inside the same project and cannot be one of the child's descendants.
 */
export function eligibleParentWorkspaces(
  child: CodeWorkspaceSummary,
  workspaces: CodeWorkspaceSummary[],
): CodeWorkspaceSummary[] {
  if (child.workspace_kind === 'primary') return []
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  return workspaces
    .filter((candidate) => {
      if (candidate.id === child.id || candidate.project_id !== child.project_id || !candidate.available) return false
      const visited = new Set<string>()
      let cursor: string | null = candidate.id
      while (cursor) {
        if (!visited.add(cursor) || cursor === child.id) return false
        cursor = byId.get(cursor)?.parent_workspace_id ?? null
      }
      return true
    })
    .sort((left, right) => {
      const leftPrimary = left.workspace_kind === 'primary' ? 0 : 1
      const rightPrimary = right.workspace_kind === 'primary' ? 0 : 1
      return leftPrimary - rightPrimary || left.display_name.localeCompare(right.display_name)
    })
}
