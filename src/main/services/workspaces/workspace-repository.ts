import { mainWorkspaceId, type Project, type Workspace } from '@shared/domain'
import { fail } from '@shared/errors'
import type { StateStore } from '../persistence/state-store'

/**
 * Store access for Workspaces. A Project starts with no Workspaces at all —
 * the main Workspace exists only once the user creates it (ADR 0011).
 */
export class WorkspaceRepository {
  constructor(private readonly store: StateStore) {}

  project(projectId: string): Project {
    const project = this.store.state.projects.find((p) => p.id === projectId)
    if (!project) fail('NOT_FOUND', 'Project not found.')
    return project!
  }

  /** The Project's main Workspace, if the user has created it. Its path always follows the project folder. */
  main(project: Project): Workspace | undefined {
    const stored = this.store.state.workspaces.find((w) => w.id === mainWorkspaceId(project.id))
    return stored && { ...stored, path: project.path }
  }

  find(workspaceId: string): Workspace | undefined {
    const stored = this.store.state.workspaces.find((w) => w.id === workspaceId)
    if (!stored || stored.kind !== 'main') return stored
    const project = this.store.state.projects.find((p) => p.id === stored.projectId)
    return project ? { ...stored, path: project.path } : stored
  }

  get(workspaceId: string): Workspace {
    const workspace = this.find(workspaceId)
    if (!workspace) fail('NOT_FOUND', 'Workspace not found.')
    return workspace!
  }

  /** Every linked worktree Hiveory knows, in open and removed projects alike. */
  knownWorktrees(): string[] {
    const { workspaces, archive } = this.store.state
    return [...workspaces, ...archive.flatMap((a) => a.workspaces)].flatMap((w) => (w.git?.worktreePath ? [w.git.worktreePath] : []))
  }

  isolated(projectId: string): Workspace[] {
    return this.store.state.workspaces
      .filter((w) => w.projectId === projectId && w.kind === 'isolated')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  save(workspace: Workspace): void {
    this.store.update((s) => {
      const index = s.workspaces.findIndex((w) => w.id === workspace.id)
      if (index >= 0) s.workspaces[index] = workspace
      else s.workspaces.push(workspace)
    })
  }

  delete(workspaceId: string): void {
    this.store.update((s) => {
      s.workspaces = s.workspaces.filter((w) => w.id !== workspaceId)
      delete s.layouts[workspaceId]
    })
  }

  /**
   * Earlier versions derived the main Workspace implicitly. Any main Workspace
   * that already has agents or a layout is kept as a real, user-owned record.
   */
  adoptImplicitMainWorkspaces(): void {
    const { projects, workspaces, instances, layouts } = this.store.state
    const missing = projects.filter((p) => {
      const id = mainWorkspaceId(p.id)
      return !workspaces.some((w) => w.id === id) && (instances.some((i) => i.workspaceId === id) || layouts[id])
    })
    if (missing.length === 0) return
    this.store.update((s) => {
      for (const p of missing) {
        s.workspaces.push({
          id: mainWorkspaceId(p.id),
          projectId: p.id,
          name: 'Main',
          kind: 'main',
          path: p.path,
          autoApprove: false,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        })
      }
    })
  }
}
