import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { mainWorkspaceId, type Workspace, type WorkspaceView } from '@shared/domain'
import { AppException, fail } from '@shared/errors'
import type { DeleteWorkspaceResult, RequestOf } from '@shared/ipc/contract'
import { generateWorkspaceName, slugify, uniqueName } from '@shared/naming/names'
import type { AgentService } from '../agents/agent-service'
import { nowIso, type Emit } from '../events'
import type { GitService } from '../git/git-service'
import type { WorktreeService } from '../git/worktree-service'
import type { WorkspaceRepository } from './workspace-repository'

export const BRANCH_PREFIX = 'hiveory/'

/**
 * Workspace lifecycle. Creating an isolated Workspace automates every Git step
 * (STARTER_PROMPT §4): base branch → names → linked worktree + branch → record → agents.
 */
export class WorkspaceService {
  constructor(
    private readonly repo: WorkspaceRepository,
    private readonly git: GitService,
    private readonly worktrees: WorktreeService,
    private readonly agents: AgentService,
    private readonly worktreeRoot: string,
    private readonly emit: Emit
  ) {}

  /** Cheap by design (no Git calls): it runs on every agent change. */
  list(projectId: string): WorkspaceView[] {
    const project = this.repo.project(projectId)
    const main = this.repo.main(project)
    return [...(main ? [main] : []), ...this.repo.isolated(projectId)].map((w) => this.view(w))
  }

  view(workspace: Workspace): WorkspaceView {
    return { ...workspace, healthy: existsSync(workspace.path), agentCount: this.agents.countInWorkspace(workspace.id) }
  }

  suggestName(projectId: string): string {
    return generateWorkspaceName(this.repo.isolated(projectId).map((w) => w.name))
  }

  async create(input: RequestOf<'workspaces.create'>): Promise<WorkspaceView> {
    return input.kind === 'main' ? this.createMain(input) : this.createIsolated(input)
  }

  /** The main Workspace runs agents directly in the project folder; no Git work is done. */
  private createMain(input: RequestOf<'workspaces.create'>): WorkspaceView {
    const project = this.repo.project(input.projectId)
    if (this.repo.main(project)) {
      fail('INVALID_INPUT', 'This project already has a main workspace.', { operation: 'Create workspace' })
    }
    const now = nowIso()
    const workspace: Workspace = {
      id: mainWorkspaceId(project.id),
      projectId: project.id,
      name: input.name.trim(),
      kind: 'main',
      path: project.path,
      association: input.association,
      autoApprove: input.autoApprove,
      createdAt: now,
      updatedAt: now
    }
    this.repo.save(workspace)
    this.agents.createInstances(workspace, input.cliSelections)
    this.emit('state.changed', { topic: 'workspaces', projectId: project.id, workspaceId: workspace.id })
    return this.view(workspace)
  }

  private async createIsolated(input: RequestOf<'workspaces.create'>): Promise<WorkspaceView> {
    const operation = 'Create workspace'
    const project = this.repo.project(input.projectId)
    const repoRoot = project.repositoryRoot ?? (await this.git.repositoryRoot(project.path))
    if (!repoRoot) {
      fail('NOT_A_REPOSITORY', 'Isolated workspaces need a Git repository.', {
        operation,
        hint: 'Initialize Git in this project, or use the Main workspace.'
      })
    }
    if (!(await this.git.hasCommits(repoRoot!))) {
      fail('NO_COMMITS', 'This repository has no commits yet.', {
        operation,
        hint: 'Make an initial commit, then create the workspace.'
      })
    }
    const baseRef = await this.git.defaultBranch(repoRoot!)
    if (!baseRef) fail('GIT_FAILED', 'Could not determine the base branch.', { operation })

    const slug = slugify(input.name)
    const usedBranches = new Set(this.repo.isolated(project.id).map((w) => w.git?.branch))
    const branch = await this.firstFreeBranch(repoRoot!, `${BRANCH_PREFIX}${slug}`, usedBranches)
    const projectDir = join(this.worktreeRoot, `${slugify(project.name, 'project')}-${project.id.slice(0, 6)}`)
    const worktreePath = join(projectDir, uniqueName(slug, (c) => existsSync(join(projectDir, c))))

    try {
      await this.worktrees.create({ repoRoot: repoRoot!, path: worktreePath, branch, baseRef: baseRef! })
    } catch (error) {
      if (error instanceof AppException) throw new AppException({ operation, ...error.error })
      throw error
    }

    const now = nowIso()
    const workspace: Workspace = {
      id: randomUUID(),
      projectId: project.id,
      name: input.name.trim(),
      kind: 'isolated',
      // Projects opened from a repository subfolder keep that subfolder inside the worktree.
      path: join(worktreePath, relative(repoRoot!, project.path)),
      git: { worktreePath, branch, baseRef },
      association: input.association,
      autoApprove: input.autoApprove,
      createdAt: now,
      updatedAt: now
    }
    this.repo.save(workspace)
    this.agents.createInstances(workspace, input.cliSelections)
    this.emit('state.changed', { topic: 'workspaces', projectId: project.id, workspaceId: workspace.id })
    return this.view(workspace)
  }

  async delete(workspaceId: string, force: boolean): Promise<DeleteWorkspaceResult> {
    const workspace = this.repo.get(workspaceId)
    if (workspace.kind === 'main') fail('FORBIDDEN', 'The main workspace cannot be deleted.')
    const project = this.repo.project(workspace.projectId)
    const repoRoot = project.repositoryRoot ?? (await this.git.repositoryRoot(project.path))

    // Processes keep the folder locked (notably on Windows); stop them first.
    this.agents.stopWorkspace(workspaceId)
    let keptBranch: string | undefined
    if (repoRoot && workspace.git?.worktreePath) {
      if (existsSync(workspace.git.worktreePath)) {
        await this.worktrees.remove(repoRoot, workspace.git.worktreePath, force)
      } else {
        await this.worktrees.prune(repoRoot)
      }
      const branch = workspace.git.branch
      if (branch && !(await this.worktrees.deleteBranchIfMerged(repoRoot, branch))) keptBranch = branch
    }
    this.agents.forgetWorkspace(workspaceId)
    this.repo.delete(workspaceId)
    this.emit('state.changed', { topic: 'workspaces', projectId: project.id, workspaceId })
    return { keptBranch }
  }

  private async firstFreeBranch(repoRoot: string, base: string, used: Set<string | undefined>): Promise<string> {
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`
      if (!used.has(candidate) && !(await this.git.localBranchExists(repoRoot, candidate))) return candidate
    }
  }
}
