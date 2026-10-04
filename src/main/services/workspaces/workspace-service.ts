import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { mainWorkspaceId, type Workspace, type WorkspaceView } from '@shared/domain'
import type { GitInfo } from '@shared/domain/github'
import type { GitStatus } from '../git/git-commands'
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
      chatUi: input.chatUi ?? false,
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
    const slug = slugify(input.name)
    let branch: string
    let baseRef: string | undefined
    if (input.useExistingBranch) {
      // Check out a branch the user already has; Hiveory never deletes it later.
      if (!input.branch) fail('INVALID_INPUT', 'Choose a branch to check out.', { operation })
      if (!(await this.git.localBranchExists(repoRoot!, input.branch!))) {
        fail('INVALID_INPUT', `Branch ${input.branch} does not exist.`, { operation })
      }
      branch = input.branch!
    } else {
      baseRef = input.baseRef || (await this.git.defaultBranch(repoRoot!))
      if (!baseRef) fail('GIT_FAILED', 'Could not determine the base branch.', { operation })
      if (!(await this.git.refExists(repoRoot!, baseRef!))) {
        fail('INVALID_INPUT', `Base branch ${baseRef} was not found.`, { operation, hint: 'Pick a branch from the list.' })
      }
      if (input.branch) {
        const problem = await this.git.branchNameProblem(repoRoot!, input.branch)
        if (problem) fail('INVALID_INPUT', problem, { operation })
        if (await this.git.localBranchExists(repoRoot!, input.branch)) {
          fail('INVALID_INPUT', `Branch ${input.branch} already exists.`, {
            operation,
            hint: 'Turn on "Use existing branch" to check it out instead.'
          })
        }
        branch = input.branch
      } else {
        const usedBranches = new Set(this.repo.isolated(project.id).map((w) => w.git?.branch))
        branch = await this.firstFreeBranch(repoRoot!, `${BRANCH_PREFIX}${slug}`, usedBranches)
      }
    }
    const projectDir = join(this.worktreeRoot, `${slugify(project.name, 'project')}-${project.id.slice(0, 6)}`)
    const worktreePath = join(projectDir, uniqueName(slug, (c) => existsSync(join(projectDir, c))))

    try {
      await this.worktrees.create({ repoRoot: repoRoot!, path: worktreePath, branch, baseRef })
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
      git: { worktreePath, branch, baseRef, createdBranch: !input.useExistingBranch },
      association: input.association,
      autoApprove: input.autoApprove,
      chatUi: input.chatUi ?? false,
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
    if (workspace.kind === 'main') {
      // Removing Main only forgets it in Hiveory; the project folder is never touched (ADR 0013).
      this.agents.forgetWorkspace(workspaceId)
      this.repo.delete(workspaceId)
      this.emit('state.changed', { topic: 'workspaces', projectId: workspace.projectId, workspaceId })
      return {}
    }
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
      // Only branches Hiveory created are cleaned up; a checked-out existing branch is left alone.
      const created = workspace.git.createdBranch !== false
      if (branch && created && !(await this.worktrees.deleteBranchIfMerged(repoRoot, branch))) keptBranch = branch
    }
    this.agents.forgetWorkspace(workspaceId)
    this.repo.delete(workspaceId)
    this.emit('state.changed', { topic: 'workspaces', projectId: project.id, workspaceId })
    return { keptBranch }
  }

  /** Branch/repository facts for the create dialog. */
  async gitInfo(projectId: string): Promise<GitInfo> {
    const project = this.repo.project(projectId)
    const repoRoot = project.repositoryRoot ?? (await this.git.repositoryRoot(project.path))
    if (!repoRoot) return { isRepo: false, hasCommits: false, branches: [], branchesInUse: [] }
    const [hasCommits, branches, defaultBranch, currentBranch, worktrees] = await Promise.all([
      this.git.hasCommits(repoRoot),
      this.git.localBranches(repoRoot),
      this.git.defaultBranch(repoRoot),
      this.git.currentBranch(repoRoot),
      this.worktrees.list(repoRoot).catch(() => [])
    ])
    return {
      isRepo: true,
      hasCommits,
      branches,
      defaultBranch,
      currentBranch,
      branchesInUse: worktrees.map((w) => w.branch).filter((b): b is string => Boolean(b))
    }
  }

  /** Live branch status of a workspace folder (changes, ahead/behind). */
  async gitStatus(workspaceId: string): Promise<GitStatus | null> {
    const workspace = this.repo.get(workspaceId)
    if (!existsSync(workspace.path)) return null
    return this.git.status(workspace.path)
  }

  /** Recreates a missing isolated workspace folder from its branch (or re-links a moved one). */
  async repair(workspaceId: string): Promise<WorkspaceView> {
    const workspace = this.repo.get(workspaceId)
    const worktreePath = workspace.git?.worktreePath
    const branch = workspace.git?.branch
    if (workspace.kind !== 'isolated' || !worktreePath || !branch) fail('INVALID_INPUT', 'Only isolated workspaces can be repaired.')
    const project = this.repo.project(workspace.projectId)
    const repoRoot = project.repositoryRoot ?? (await this.git.repositoryRoot(project.path))
    if (!repoRoot) fail('NOT_A_REPOSITORY', 'The project is no longer a Git repository.')
    if (existsSync(worktreePath!)) {
      await this.worktrees.repairLink(repoRoot!, worktreePath!)
    } else {
      if (!(await this.git.localBranchExists(repoRoot!, branch!))) {
        fail('NOT_FOUND', `Branch ${branch} no longer exists, so the workspace cannot be rebuilt.`, {
          hint: 'Delete this workspace and create a new one.'
        })
      }
      await this.worktrees.recreate(repoRoot!, worktreePath!, branch!)
    }
    this.emit('state.changed', { topic: 'workspaces', projectId: project.id, workspaceId })
    return this.view(workspace)
  }

  private async firstFreeBranch(repoRoot: string, base: string, used: Set<string | undefined>): Promise<string> {
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`
      if (!used.has(candidate) && !(await this.git.localBranchExists(repoRoot, candidate))) return candidate
    }
  }
}
