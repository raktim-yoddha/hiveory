import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { branchPrefixOf, DEFAULT_BRANCH_PREFIX, mainWorkspaceId, PRIMARY_NAME, type Project, type Workspace, type WorkspaceView } from '@shared/domain'
import type { GitInfo } from '@shared/domain/github'
import { stripRemote, type GitStatus } from '../git/git-commands'
import { AppException, fail } from '@shared/errors'
import type { DeleteWorkspaceResult, RequestOf } from '@shared/ipc/contract'
import { generateWorkspaceName, slugify, uniqueName } from '@shared/naming/names'
import type { AgentService } from '../agents/agent-service'
import { nowIso, type Emit } from '../events'
import type { HostKit } from '../hosts/host-kit'
import { treeKey, type WorkspaceRepository } from './workspace-repository'

export const BRANCH_PREFIX = DEFAULT_BRANCH_PREFIX

/** What one sync changed: Worktrees Git showed that are new here, and ones deleted outside Hiveory. */
export interface SyncResult {
  added: string[]
  removed: string[]
}

/** Hands out the kit of a project's machine: this computer, or an SSH host (ADR 0022). */
export interface KitSource {
  kit(host?: Project['host']): Promise<HostKit>
}

/**
 * Workspace lifecycle. Creating an isolated Workspace automates every Git step
 * (STARTER_PROMPT §4): base branch → names → linked worktree + branch → record → agents.
 * Git, worktrees and folders go through the project's host kit, so the same steps
 * run on this computer or on a machine reached over SSH.
 */
export class WorkspaceService {
  constructor(
    private readonly repo: WorkspaceRepository,
    private readonly kits: KitSource,
    private readonly agents: AgentService,
    private readonly emit: Emit
  ) {}

  private kitOf(project: Project): Promise<HostKit> {
    return this.kits.kit(project.host)
  }

  private async repoRootOf(project: Project, kit: HostKit): Promise<string | undefined> {
    return project.repositoryRoot ?? (await kit.git.repositoryRoot(project.path))
  }

  /** Cheap by design (no Git calls): it runs on every agent change. */
  list(projectId: string): WorkspaceView[] {
    const project = this.repo.project(projectId)
    const main = this.repo.main(project)
    return [...(main ? [main] : []), ...this.repo.isolated(projectId)].map((w) => this.view(w))
  }

  view(workspace: Workspace): WorkspaceView {
    // A remote folder is checked when it is used, never with a network round trip per list.
    const remote = Boolean(this.repo.findProject(workspace.projectId)?.host)
    return { ...workspace, healthy: remote || existsSync(workspace.path), agentCount: this.agents.countInWorkspace(workspace.id) }
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
      fail('INVALID_INPUT', 'This workspace already has a main worktree.', { operation: 'Create worktree' })
    }
    const owner = this.repo.mainTreeOwner(project)
    if (owner) {
      fail('INVALID_INPUT', `This folder's checkout is already the ${owner.workspace.name} worktree of ${owner.project.name}.`, {
        operation: 'Create worktree',
        hint: `Agents run in one place per checkout. Use it in ${owner.project.name}, or remove it there first (nothing on disk changes).`
      })
    }
    const now = nowIso()
    const workspace: Workspace = {
      id: mainWorkspaceId(project.id),
      projectId: project.id,
      name: PRIMARY_NAME,
      kind: 'main',
      path: project.path,
      association: input.association,
      autoApprove: input.autoApprove,
      chatUi: input.chatUi ?? project.settings?.agentView === 'chat',
      createdAt: now,
      updatedAt: now
    }
    this.repo.save(workspace)
    this.agents.createInstances(workspace, input.cliSelections)
    this.emit('state.changed', { topic: 'workspaces', projectId: project.id, workspaceId: workspace.id })
    return this.view(workspace)
  }

  private async createIsolated(input: RequestOf<'workspaces.create'>): Promise<WorkspaceView> {
    const operation = 'Create worktree'
    const project = this.repo.project(input.projectId)
    const kit = await this.kitOf(project)
    const git = kit.git
    const repoRoot = await this.repoRootOf(project, kit)
    if (!repoRoot) {
      fail('NOT_A_REPOSITORY', 'Isolated worktrees need a Git repository.', {
        operation,
        hint: 'Initialize Git in this workspace, or use the Primary worktree.'
      })
    }
    if (!(await git.hasCommits(repoRoot!))) {
      fail('NO_COMMITS', 'This repository has no commits yet.', {
        operation,
        hint: 'Make an initial commit, then create the worktree.'
      })
    }
    const slug = slugify(input.name)
    let branch: string
    let baseRef: string | undefined
    let track = false
    let createdBranch = !input.useExistingBranch
    if (input.remoteBranch) {
      // A branch on the remote (origin/x): a local x following it, or x itself when it already exists here.
      if (!(await git.refExists(repoRoot!, input.remoteBranch))) {
        fail('INVALID_INPUT', `Remote branch ${input.remoteBranch} was not found.`, { operation, hint: 'Refresh the list and pick it again.' })
      }
      branch = stripRemote(input.remoteBranch)
      if (await git.localBranchExists(repoRoot!, branch)) createdBranch = false
      else {
        baseRef = input.remoteBranch
        track = true
        createdBranch = true
      }
    } else if (input.useExistingBranch) {
      // Check out a branch the user already has; Hiveory never deletes it later.
      if (!input.branch) fail('INVALID_INPUT', 'Choose a branch to check out.', { operation })
      if (!(await git.localBranchExists(repoRoot!, input.branch!))) {
        fail('INVALID_INPUT', `Branch ${input.branch} does not exist.`, { operation })
      }
      branch = input.branch!
    } else {
      // The Workspace's own base branch, then the repository's default (ADR 0037).
      baseRef = input.baseRef || project.settings?.baseRef || (await git.defaultBranch(repoRoot!))
      if (!baseRef) fail('GIT_FAILED', 'Could not determine the base branch.', { operation })
      if (!(await git.refExists(repoRoot!, baseRef!))) {
        fail('INVALID_INPUT', `Base branch ${baseRef} was not found.`, { operation, hint: 'Pick a branch from the list.' })
      }
      if (input.branch) {
        const problem = await git.branchNameProblem(repoRoot!, input.branch)
        if (problem) fail('INVALID_INPUT', problem, { operation })
        if (await git.localBranchExists(repoRoot!, input.branch)) {
          fail('INVALID_INPUT', `Branch ${input.branch} already exists.`, {
            operation,
            hint: 'Turn on "Use existing branch" to check it out instead.'
          })
        }
        branch = input.branch
      } else {
        const usedBranches = new Set(this.repo.isolated(project.id).map((w) => w.git?.branch))
        branch = await this.firstFreeBranch(kit, repoRoot!, `${branchPrefixOf(project)}${slug}`, usedBranches)
      }
    }
    // Paths follow the host's rules (POSIX on a Linux server even when Hiveory runs on Windows).
    const paths = kit.paths
    const projectDir = paths.join(kit.worktreeRoot, `${slugify(project.name, 'project')}-${project.id.slice(0, 6)}`)
    const taken = new Set((await kit.fs.readDir(projectDir)).map((e) => e.name))
    const worktreePath = paths.join(projectDir, uniqueName(slug, (c) => taken.has(c)))

    try {
      await kit.worktrees.create({ repoRoot: repoRoot!, path: worktreePath, branch, baseRef, ...(track ? { track } : {}) })
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
      path: paths.join(worktreePath, paths.relative(repoRoot!, project.path)),
      git: { worktreePath, branch, baseRef, createdBranch },
      association: input.association,
      autoApprove: input.autoApprove,
      chatUi: input.chatUi ?? project.settings?.agentView === 'chat',
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
    const kit = await this.kitOf(project)
    const repoRoot = await this.repoRootOf(project, kit)

    // Processes keep the folder locked (notably on Windows); stop them first.
    this.agents.stopWorkspace(workspaceId)
    let keptBranch: string | undefined
    if (repoRoot && workspace.git?.worktreePath) {
      if (await kit.fs.exists(workspace.git.worktreePath)) {
        await kit.worktrees.remove(repoRoot, workspace.git.worktreePath, force)
      } else {
        await kit.worktrees.prune(repoRoot)
      }
      const branch = workspace.git.branch
      // Only branches Hiveory created are cleaned up; a checked-out existing branch is left alone.
      const created = workspace.git.createdBranch !== false
      if (branch && created && !(await kit.worktrees.deleteBranchIfMerged(repoRoot, branch))) keptBranch = branch
    }
    this.agents.forgetWorkspace(workspaceId)
    this.repo.delete(workspaceId)
    this.emit('state.changed', { topic: 'workspaces', projectId: project.id, workspaceId })
    return { keptBranch }
  }

  /**
   * Matches a Workspace's Worktrees to Git (ADR 0038). The Primary always exists; every linked
   * worktree Git knows shows up, once app-wide, wherever it lives; a worktree whose folder was
   * deleted outside Hiveory is forgotten with its agents; branches follow what is checked out.
   * A Workspace whose own folder is gone is left alone: it shows as missing.
   */
  async sync(projectId: string): Promise<SyncResult> {
    const result: SyncResult = { added: [], removed: [] }
    const project = this.repo.findProject(projectId)
    if (!project) return result
    const kit = await this.kitOf(project)
    if (!(await kit.fs.exists(project.path))) return result
    let changed = this.ensurePrimary(project)
    const repoRoot = await this.repoRootOf(project, kit)
    const entries = repoRoot ? await kit.worktrees.list(repoRoot).catch(() => null) : null
    if (!repoRoot || !entries) {
      // No Git to ask: a worktree whose folder is gone can only be a leftover, never a real one (ADR 0039).
      for (const workspace of this.repo.isolated(projectId)) {
        if (await kit.fs.exists(workspace.git?.worktreePath ?? workspace.path)) continue
        this.agents.forgetWorkspace(workspace.id)
        this.repo.delete(workspace.id)
        result.removed.push(workspace.name)
      }
      if (changed || result.removed.length) this.emit('state.changed', { topic: 'workspaces', projectId })
      return result
    }
    const tree = (path: string): string => treeKey(path, project.host)
    const listed = new Map(entries.map((e) => [tree(e.path), e]))
    const main = this.repo.main(project)
    const mainBranch = listed.get(tree(repoRoot))?.branch
    if (main && mainBranch && main.git?.branch !== mainBranch) {
      this.repo.save({ ...main, git: { ...main.git, branch: mainBranch } })
      changed = true
    }
    for (const workspace of this.repo.isolated(projectId)) {
      const folder = workspace.git?.worktreePath
      if (!folder) continue
      const entry = listed.get(tree(folder))
      if (await kit.fs.exists(folder)) {
        if (entry?.branch && entry.branch !== workspace.git?.branch) {
          this.repo.save({ ...workspace, git: { ...workspace.git, branch: entry.branch } })
          changed = true
        }
      } else if (!entry || entry.prunable) {
        this.agents.forgetWorkspace(workspace.id)
        this.repo.delete(workspace.id)
        result.removed.push(workspace.name)
      }
    }
    if (result.removed.length) await kit.worktrees.prune(repoRoot)
    const known = this.repo.knownTrees()
    const paths = kit.paths
    for (const entry of entries.slice(1)) {
      if (entry.bare || entry.prunable || known.has(tree(entry.path))) continue
      const now = nowIso()
      const name = paths.basename(entry.path)
      this.repo.save({
        id: randomUUID(),
        projectId,
        name,
        kind: 'isolated',
        // A Workspace opened from a repository subfolder keeps that subfolder inside each worktree.
        path: paths.join(entry.path, paths.relative(repoRoot, project.path)),
        git: { worktreePath: paths.normalize(entry.path), branch: entry.branch, createdBranch: false },
        autoApprove: false,
        createdAt: now,
        updatedAt: now
      })
      result.added.push(name)
    }
    if (changed || result.added.length || result.removed.length) this.emit('state.changed', { topic: 'workspaces', projectId })
    return result
  }

  /** Syncs every Workspace on this computer (remote ones sync when added, not on a timer). */
  async syncAll(): Promise<SyncResult> {
    const total: SyncResult = { added: [], removed: [] }
    for (const project of this.repo.projects().filter((p) => !p.host)) {
      const { added, removed } = await this.sync(project.id).catch(() => ({ added: [], removed: [] }))
      total.added.push(...added)
      total.removed.push(...removed)
    }
    return total
  }

  /** Every Workspace has its Primary, unless another Workspace already runs agents in that checkout (ADR 0021). */
  private ensurePrimary(project: Project): boolean {
    if (this.repo.main(project) || this.repo.mainTreeOwner(project)) return false
    const now = nowIso()
    this.repo.save({
      id: mainWorkspaceId(project.id),
      projectId: project.id,
      name: PRIMARY_NAME,
      kind: 'main',
      path: project.path,
      autoApprove: false,
      createdAt: now,
      updatedAt: now
    })
    return true
  }

  /** Branch/repository facts for the create dialog. */
  async gitInfo(projectId: string, fetch = false): Promise<GitInfo> {
    const project = this.repo.project(projectId)
    const kit = await this.kitOf(project)
    const repoRoot = await this.repoRootOf(project, kit)
    if (!repoRoot) return { isRepo: false, hasCommits: false, branches: [], branchesInUse: [], remoteBranches: [] }
    const fetched = fetch ? await kit.git.fetch(repoRoot) : undefined
    const [hasCommits, branches, remoteBranches, defaultBranch, currentBranch, worktrees] = await Promise.all([
      kit.git.hasCommits(repoRoot),
      kit.git.localBranches(repoRoot),
      kit.git.remoteBranches(repoRoot),
      kit.git.defaultBranch(repoRoot),
      kit.git.currentBranch(repoRoot),
      kit.worktrees.list(repoRoot).catch(() => [])
    ])
    return {
      isRepo: true,
      hasCommits,
      branches,
      defaultBranch,
      currentBranch,
      branchesInUse: worktrees.map((w) => w.branch).filter((b): b is string => Boolean(b)),
      remoteBranches,
      ...(fetched === false ? { fetchFailed: true } : {})
    }
  }

  /** Live branch status of a workspace folder (changes, ahead/behind). */
  async gitStatus(workspaceId: string): Promise<GitStatus | null> {
    const workspace = this.repo.get(workspaceId)
    const kit = await this.kitOf(this.repo.project(workspace.projectId))
    if (!(await kit.fs.exists(workspace.path))) return null
    return kit.git.status(workspace.path)
  }

  /** Recreates a missing isolated workspace folder from its branch (or re-links a moved one). */
  async repair(workspaceId: string): Promise<WorkspaceView> {
    const workspace = this.repo.get(workspaceId)
    const worktreePath = workspace.git?.worktreePath
    const branch = workspace.git?.branch
    if (workspace.kind !== 'isolated' || !worktreePath || !branch) fail('INVALID_INPUT', 'Only isolated worktrees can be repaired.')
    const project = this.repo.project(workspace.projectId)
    const kit = await this.kitOf(project)
    const repoRoot = await this.repoRootOf(project, kit)
    if (!repoRoot) fail('NOT_A_REPOSITORY', 'The workspace is no longer a Git repository.')
    if (await kit.fs.exists(worktreePath!)) {
      await kit.worktrees.repairLink(repoRoot!, worktreePath!)
    } else {
      if (!(await kit.git.localBranchExists(repoRoot!, branch!))) {
        fail('NOT_FOUND', `Branch ${branch} no longer exists, so the worktree cannot be rebuilt.`, {
          hint: 'Delete this worktree and create a new one.'
        })
      }
      await kit.worktrees.recreate(repoRoot!, worktreePath!, branch!)
    }
    this.emit('state.changed', { topic: 'workspaces', projectId: project.id, workspaceId })
    return this.view(workspace)
  }

  private async firstFreeBranch(kit: HostKit, repoRoot: string, base: string, used: Set<string | undefined>): Promise<string> {
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`
      if (!used.has(candidate) && !(await kit.git.localBranchExists(repoRoot, candidate))) return candidate
    }
  }
}
