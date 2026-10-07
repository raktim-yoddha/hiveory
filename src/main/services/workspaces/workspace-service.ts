import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { mainWorkspaceId, type Project, type Workspace, type WorkspaceView } from '@shared/domain'
import type { GitInfo } from '@shared/domain/github'
import type { GitStatus } from '../git/git-commands'
import { AppException, fail } from '@shared/errors'
import type { DeleteWorkspaceResult, RequestOf } from '@shared/ipc/contract'
import type { FoundWorktrees } from '@shared/domain'
import { generateWorkspaceName, slugify, uniqueName } from '@shared/naming/names'
import type { AgentService } from '../agents/agent-service'
import { nowIso, type Emit } from '../events'
import type { HostKit } from '../hosts/host-kit'
import type { WorkspaceRepository } from './workspace-repository'

export const BRANCH_PREFIX = 'hiveory/'

const key = (path: string): string => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path))
const inside = (path: string, folder: string): boolean => key(path).startsWith(key(folder) + sep)

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
    /** This computer's workspaces folder (scanned by Restore previous). */
    private readonly worktreeRoot: string,
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
    if (input.useExistingBranch) {
      // Check out a branch the user already has; Hiveory never deletes it later.
      if (!input.branch) fail('INVALID_INPUT', 'Choose a branch to check out.', { operation })
      if (!(await git.localBranchExists(repoRoot!, input.branch!))) {
        fail('INVALID_INPUT', `Branch ${input.branch} does not exist.`, { operation })
      }
      branch = input.branch!
    } else {
      baseRef = input.baseRef || (await git.defaultBranch(repoRoot!))
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
        branch = await this.firstFreeBranch(kit, repoRoot!, `${BRANCH_PREFIX}${slug}`, usedBranches)
      }
    }
    // Paths follow the host's rules (POSIX on a Linux server even when Hiveory runs on Windows).
    const paths = kit.paths
    const projectDir = paths.join(kit.worktreeRoot, `${slugify(project.name, 'project')}-${project.id.slice(0, 6)}`)
    const taken = new Set((await kit.fs.readDir(projectDir)).map((e) => e.name))
    const worktreePath = paths.join(projectDir, uniqueName(slug, (c) => taken.has(c)))

    try {
      await kit.worktrees.create({ repoRoot: repoRoot!, path: worktreePath, branch, baseRef })
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
   * Brings back Hiveory workspaces that exist on disk but not in Hiveory — for
   * example from before the project was removed and added again (its folder then
   * got a new id). Only linked worktrees inside Hiveory's workspaces folder on this
   * computer count; each becomes an isolated workspace again. Returns how many came back.
   */
  async adoptWorktrees(projectId: string): Promise<number> {
    const project = this.repo.project(projectId)
    if (project.host) return 0
    const kit = await this.kitOf(project)
    const repoRoot = await this.repoRootOf(project, kit)
    if (!repoRoot) return 0
    const known = new Set(this.repo.knownWorktrees().map(key))
    const entries = await kit.worktrees.list(repoRoot).catch(() => [])
    let adopted = 0
    for (const entry of entries.slice(1)) {
      if (entry.bare || !inside(entry.path, this.worktreeRoot) || known.has(key(entry.path)) || !existsSync(entry.path)) continue
      const now = nowIso()
      this.repo.save({
        id: randomUUID(),
        projectId,
        name: basename(entry.path),
        kind: 'isolated',
        path: join(entry.path, relative(repoRoot, project.path)),
        git: { worktreePath: entry.path, branch: entry.branch, createdBranch: entry.branch?.startsWith(BRANCH_PREFIX) ?? false },
        autoApprove: false,
        chatUi: false,
        createdAt: now,
        updatedAt: now
      })
      adopted++
    }
    if (adopted) this.emit('state.changed', { topic: 'workspaces', projectId })
    return adopted
  }

  /**
   * Hiveory workspace folders on this computer that no project knows: grouped by
   * the repository they belong to (read from each worktree's .git file), for
   * "Restore previous" in Add project.
   */
  foundWorktrees(): FoundWorktrees[] {
    const known = new Set(this.repo.knownWorktrees().map(key))
    const groups = new Map<string, FoundWorktrees>()
    const list = (dir: string): string[] => {
      try {
        return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name))
      } catch {
        return []
      }
    }
    for (const projectDir of list(this.worktreeRoot)) {
      for (const folder of list(projectDir)) {
        if (known.has(key(folder))) continue
        let gitdir: string
        try {
          gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(folder, '.git'), 'utf8'))?.[1]?.trim() ?? ''
        } catch {
          continue
        }
        // <repo>/.git/worktrees/<name> → <repo>
        const at = gitdir.replace(/\\/g, '/').lastIndexOf('/.git/worktrees/')
        if (at < 0) continue
        const repoRoot = resolve(gitdir.slice(0, at))
        if (!existsSync(repoRoot)) continue
        const group = groups.get(key(repoRoot)) ?? { repoRoot, name: basename(repoRoot), workspaces: [] }
        group.workspaces.push(basename(folder))
        groups.set(key(repoRoot), group)
      }
    }
    return [...groups.values()]
  }

  /** Branch/repository facts for the create dialog. */
  async gitInfo(projectId: string): Promise<GitInfo> {
    const project = this.repo.project(projectId)
    const kit = await this.kitOf(project)
    const repoRoot = await this.repoRootOf(project, kit)
    if (!repoRoot) return { isRepo: false, hasCommits: false, branches: [], branchesInUse: [] }
    const [hasCommits, branches, defaultBranch, currentBranch, worktrees] = await Promise.all([
      kit.git.hasCommits(repoRoot),
      kit.git.localBranches(repoRoot),
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
      branchesInUse: worktrees.map((w) => w.branch).filter((b): b is string => Boolean(b))
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
