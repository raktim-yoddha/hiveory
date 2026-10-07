import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { hostKey, mainWorkspaceId, type Project, type Workspace } from '@shared/domain'
import { fail } from '@shared/errors'
import type { PersistedState } from '../persistence/schema'
import type { StateStore } from '../persistence/state-store'

/**
 * A folder as one comparable key: its machine, then the path (symlinks/junctions resolved and
 * case folded on Windows for this computer; a remote host's path is compared as it is).
 */
const treeKey = (path: string, host?: Project['host']): string => {
  if (host) return `${hostKey(host)}|${path}`
  let real = resolve(path)
  try {
    real = realpathSync.native(real)
  } catch {
    // A missing folder still compares by its resolved path.
  }
  return `local|${process.platform === 'win32' ? real.toLowerCase() : real}`
}

/** The working tree a workspace runs agents in: a Main workspace uses the project's whole checkout. */
const treeOf = (workspace: Workspace, project: Project | undefined): string =>
  workspace.kind === 'main' ? (project?.repositoryRoot ?? project?.path ?? workspace.path) : (workspace.git?.worktreePath ?? workspace.path)

/**
 * The open workspace that already runs agents in `project`'s main working tree, from
 * another project. One checkout hosts one workspace app-wide, so a repository opened
 * twice (its root and a subfolder, or a linked worktree opened as a project) never gets
 * two Main workspaces running agents on the same files (ADR 0021).
 */
export const mainTreeOwner = (state: PersistedState, project: Project): { project: Project; workspace: Workspace } | undefined => {
  const tree = treeKey(project.repositoryRoot ?? project.path, project.host)
  for (const workspace of state.workspaces) {
    if (workspace.projectId === project.id) continue
    const owner = state.projects.find((p) => p.id === workspace.projectId)
    if (owner && treeKey(treeOf(workspace, owner), owner.host) === tree) return { project: owner, workspace }
  }
  return undefined
}

/**
 * Store access for Workspaces. A Project starts with no Workspaces at all —
 * the main Workspace exists only once the user creates it (ADR 0011).
 */
export class WorkspaceRepository {
  constructor(private readonly store: StateStore) {}

  findProject(projectId: string): Project | undefined {
    return this.store.state.projects.find((p) => p.id === projectId)
  }

  project(projectId: string): Project {
    const project = this.store.state.projects.find((p) => p.id === projectId)
    if (!project) fail('NOT_FOUND', 'Workspace not found.')
    return project!
  }

  /** The Project's main Workspace, if the user has created it. Its path always follows the project folder. */
  main(project: Project): Workspace | undefined {
    const stored = this.store.state.workspaces.find((w) => w.id === mainWorkspaceId(project.id))
    return stored && { ...stored, path: project.path }
  }

  mainTreeOwner(project: Project): { project: Project; workspace: Workspace } | undefined {
    return mainTreeOwner(this.store.state, project)
  }

  find(workspaceId: string): Workspace | undefined {
    const stored = this.store.state.workspaces.find((w) => w.id === workspaceId)
    if (!stored || stored.kind !== 'main') return stored
    const project = this.store.state.projects.find((p) => p.id === stored.projectId)
    return project ? { ...stored, path: project.path } : stored
  }

  get(workspaceId: string): Workspace {
    const workspace = this.find(workspaceId)
    if (!workspace) fail('NOT_FOUND', 'Worktree not found.')
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
