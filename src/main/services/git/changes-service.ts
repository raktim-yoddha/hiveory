import type { ChangeSet, ChangeSource, CommitSummary } from '@shared/domain/changes'
import type { TurnCheckpoint } from '@shared/domain/chat'
import { fail } from '@shared/errors'
import type { HostKit } from '../hosts/host-kit'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'
import type { KitSource } from '../workspaces/workspace-service'
import { listed, WorktreeChanges, type Git } from './changes'
import { commitAll, discardFiles, pushBranch } from './commit-changes'
import { GitCommandError } from './git-service'

const GIT_TIMEOUT_MS = 30_000

/** git in `cwd` on the kit's machine; a failure throws with git's own message. */
export const gitOn = (kit: Pick<HostKit, 'exec'>, cwd: string): Git => async (args, options) => {
  const result = await kit.exec({ file: 'git', args, cwd, timeoutMs: GIT_TIMEOUT_MS, ...(options?.env ? { env: options.env } : {}) })
  if (result.code === 0 || (result.code !== null && options?.ok?.includes(result.code))) return result.stdout
  throw new GitCommandError(args, result.stderr, result.code)
}

/** A chat turn's trees: `after` is absent while the turn still runs (its changes so far are shown). */
export type TurnTrees = (chatId: string, messageId: string) => TurnCheckpoint | undefined

/**
 * The side panel's Changes tab (ADR 0058): a worktree's uncommitted changes, its branch against the
 * base, one commit, or one chat turn — read from Git where the worktree lives.
 */
export class ChangesService {
  constructor(
    private readonly repo: WorkspaceRepository,
    private readonly kits: KitSource,
    private readonly turnTrees: TurnTrees
  ) {}

  private async gitIn(workspaceId: string): Promise<{ git: Git; base?: string }> {
    const workspace = this.repo.get(workspaceId)
    const project = this.repo.project(workspace.projectId)
    const kit = await this.kits.kit(project.host)
    return { git: gitOn(kit, workspace.path), base: workspace.git?.baseRef ?? project.settings?.baseRef }
  }

  private async reader(workspaceId: string): Promise<{ changes: WorktreeChanges; base?: string }> {
    const { git, base } = await this.gitIn(workspaceId)
    return { changes: new WorktreeChanges(git), base }
  }

  /** Commits every change in the worktree (ADR 0060). */
  async commit(workspaceId: string, message: string): Promise<{ sha: string }> {
    return { sha: await commitAll((await this.gitIn(workspaceId)).git, message) }
  }

  /** Pushes the worktree's branch, tracking origin's branch of the same name when it has none yet (ADR 0060). */
  async push(workspaceId: string): Promise<{ branch: string; upstream: string }> {
    return pushBranch((await this.gitIn(workspaceId)).git)
  }

  /** Puts files back as they are in the last commit (ADR 0060). */
  async discard(workspaceId: string, paths: string[]): Promise<void> {
    await discardFiles((await this.gitIn(workspaceId)).git, paths)
  }

  /** The commit the branch is compared against: its merge base with the base branch. */
  private async branchBase(changes: WorktreeChanges, base: string | undefined): Promise<{ from?: string; base?: string }> {
    for (const candidate of [base, 'origin/HEAD', 'main', 'master'].filter((b): b is string => Boolean(b))) {
      const from = await changes.mergeBase(candidate)
      if (from) return { from, base: candidate.replace(/^origin\/HEAD$/, 'origin') }
    }
    return {}
  }

  private turn(source: Extract<ChangeSource, { kind: 'turn' }>): TurnCheckpoint {
    return this.turnTrees(source.chatId, source.messageId) ?? fail('NOT_FOUND', 'That turn has no saved checkpoint.')
  }

  async list(workspaceId: string, source: ChangeSource): Promise<ChangeSet> {
    const { changes, base: configured } = await this.reader(workspaceId)
    const head = await changes.head()
    if (!head) return { files: [], additions: 0, deletions: 0, note: 'This folder is not a Git repository.' }
    const branch = await changes.branch()
    if (source.kind === 'uncommitted') {
      const files = await changes.againstWorktree(head)
      return { branch, ...listed(files) }
    }
    if (source.kind === 'branch') {
      const { from, base } = await this.branchBase(changes, configured)
      if (!from) return { branch, files: [], additions: 0, deletions: 0, note: 'No base branch to compare with.' }
      const files = await changes.againstWorktree(from)
      return { branch, base, ...listed(files) }
    }
    if (source.kind === 'commit') {
      const files = await changes.commit(source.sha)
      return { branch, base: source.sha.slice(0, 7), ...listed(files) }
    }
    const turn = this.turn(source)
    const files = turn.after ? await changes.between(turn.before, turn.after) : await changes.againstWorktree(turn.before)
    return { branch, ...listed(files) }
  }

  /** One file's unified diff for the same source. */
  async diff(workspaceId: string, source: ChangeSource, path: string): Promise<string> {
    const { changes, base } = await this.reader(workspaceId)
    const head = await changes.head()
    if (!head) return ''
    if (source.kind === 'commit') return changes.fileInCommit(source.sha, path)
    if (source.kind === 'turn') {
      const turn = this.turn(source)
      if (turn.after) return changes.fileBetween(turn.before, turn.after, path)
      return changes.fileAgainstWorktree(turn.before, path, false)
    }
    const from = source.kind === 'branch' ? (await this.branchBase(changes, base)).from : head
    if (!from) return ''
    return changes.fileAgainstWorktree(from, path, await changes.isUntracked(path))
  }

  /** The branch's own commits (since its base), else the latest ones. */
  async commits(workspaceId: string): Promise<CommitSummary[]> {
    const { changes, base } = await this.reader(workspaceId)
    if (!(await changes.head())) return []
    const { from } = await this.branchBase(changes, base)
    const own = from ? await changes.commits(`${from}..HEAD`) : []
    return own.length ? own : changes.commits()
  }
}
