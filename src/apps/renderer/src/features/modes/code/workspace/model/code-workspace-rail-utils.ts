import type { CodePaneLayout, CodePaneNode, CodeWorkspaceSummary } from '../../../../../shared/api/hiveory-client'

export function isEmptyPanePlaceholder(node: CodePaneNode, layout: CodePaneLayout): boolean {
  return layout.nodes.length === 1
    && layout.root_id === node.pane_id
    && node.kind === 'empty'
    && node.children.length === 0
    && node.resource_id === null
}

export function visiblePaneLeaves(layout: CodePaneLayout | null): CodePaneNode[] {
  if (!layout) return []
  return layout.nodes.filter((node) => node.children.length === 0 && !isEmptyPanePlaceholder(node, layout))
}

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
