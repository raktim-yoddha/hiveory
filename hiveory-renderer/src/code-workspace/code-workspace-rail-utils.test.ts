import { describe, expect, it } from 'vitest'
import type { CodeWorkspaceSummary } from '../api/hiveory-client'
import { eligibleParentWorkspaces, shouldShowProjectWorkspaceRows } from './code-workspace-rail-utils'

function workspace(overrides: Partial<CodeWorkspaceSummary> = {}): CodeWorkspaceSummary {
  return {
    id: 'workspace-child',
    host_id: 'local',
    display_name: 'Child',
    root_path: 'C:/child',
    repository_name: 'repo',
    branch: 'feature/child',
    is_git_repository: true,
    trust: 'trusted',
    capabilities: ['read_files'],
    project_id: 'project-1',
    workspace_kind: 'managed_worktree',
    worktree_name: 'child',
    base_ref: 'HEAD',
    parent_workspace_id: null,
    managed_by_app: true,
    available: true,
    unavailable_reason: null,
    updated_at_unix_ms: 1,
    ...overrides,
  }
}

describe('workspace rail hierarchy helpers', () => {
  it('hides the primary row for a project with one workspace', () => {
    expect(shouldShowProjectWorkspaceRows(1)).toBe(false)
    expect(shouldShowProjectWorkspaceRows(2)).toBe(true)
  })

  it('keeps parent choices in-project and prevents descendant cycles', () => {
    const primary = workspace({ id: 'workspace-primary', display_name: 'Primary', workspace_kind: 'primary', worktree_name: null, base_ref: null, managed_by_app: false })
    const child = workspace({ id: 'workspace-child', parent_workspace_id: null })
    const descendant = workspace({ id: 'workspace-descendant', display_name: 'Descendant', parent_workspace_id: child.id })
    const otherProject = workspace({ id: 'workspace-other', display_name: 'Other project', project_id: 'project-2' })
    expect(eligibleParentWorkspaces(child, [primary, child, descendant, otherProject]).map((item) => item.id)).toEqual([primary.id])
  })
})
