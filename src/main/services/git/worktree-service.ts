import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { AppException } from '@shared/errors'
import { gitArgs, isBranchInUseError, isDirtyWorktreeError, isUnmergedBranchError, parseWorktreeList, type WorktreeEntry } from './git-commands'
import { GitCommandError, type GitService } from './git-service'

export interface CreateWorktreeInput {
  repoRoot: string
  path: string
  branch: string
  /** New branch from this ref; omit to check out an existing `branch`. */
  baseRef?: string
}

const gitFailure = (message: string, error: unknown, hint?: string): AppException =>
  error instanceof AppException
    ? error
    : new AppException({
        code: 'GIT_FAILED',
        message,
        hint,
        detail: error instanceof GitCommandError ? error.stderr.trim() || error.message : String(error)
      })

/** Owns linked-worktree orchestration so users never run `git worktree` themselves. */
export class WorktreeService {
  constructor(private readonly git: GitService) {}

  async create(input: CreateWorktreeInput): Promise<void> {
    mkdirSync(dirname(input.path), { recursive: true })
    try {
      await this.git.run(
        input.repoRoot,
        input.baseRef
          ? gitArgs.worktreeAdd(input.path, input.branch, input.baseRef)
          : gitArgs.worktreeAddExisting(input.path, input.branch)
      )
    } catch (error) {
      if (error instanceof GitCommandError && isBranchInUseError(error.stderr)) {
        throw new AppException({
          code: 'GIT_FAILED',
          message: `Branch ${input.branch} is already checked out in another folder.`,
          hint: 'Pick a different branch, or close the other checkout first.'
        })
      }
      throw gitFailure('Could not create the workspace folder.', error, 'Check the details below, then try again.')
    }
  }

  /** Removes a linked worktree. A dirty worktree needs `force`, so nothing is lost silently. */
  async remove(repoRoot: string, path: string, force: boolean): Promise<void> {
    try {
      await this.git.run(repoRoot, gitArgs.worktreeRemove(path, force))
    } catch (error) {
      if (error instanceof GitCommandError && isDirtyWorktreeError(error.stderr)) {
        throw new AppException({
          code: 'WORKTREE_DIRTY',
          message: 'This workspace has uncommitted changes.',
          hint: 'Commit or discard them first, or delete anyway to lose them.'
        })
      }
      if (error instanceof GitCommandError && /is not a working tree/i.test(error.stderr)) {
        await this.prune(repoRoot)
        return
      }
      throw gitFailure('Could not remove the workspace folder.', error)
    }
  }

  /** Deletes a branch only if merged. Returns false when it was kept to protect unmerged work. */
  async deleteBranchIfMerged(repoRoot: string, branch: string): Promise<boolean> {
    try {
      await this.git.run(repoRoot, gitArgs.deleteMergedBranch(branch))
      return true
    } catch (error) {
      if (error instanceof GitCommandError && isUnmergedBranchError(error.stderr)) return false
      throw gitFailure(`Could not delete branch ${branch}.`, error)
    }
  }

  /** Rebuilds a workspace whose folder vanished: prune the stale entry, check the branch out again. */
  async recreate(repoRoot: string, path: string, branch: string): Promise<void> {
    await this.prune(repoRoot)
    await this.create({ repoRoot, path, branch })
  }

  /** Re-links a moved/renamed worktree folder with its repository. */
  async repairLink(repoRoot: string, path: string): Promise<void> {
    await this.git.run(repoRoot, gitArgs.worktreeRepair(path)).catch(() => undefined)
  }

  async list(repoRoot: string): Promise<WorktreeEntry[]> {
    return parseWorktreeList(await this.git.run(repoRoot, gitArgs.worktreeList()))
  }

  async prune(repoRoot: string): Promise<void> {
    await this.git.run(repoRoot, gitArgs.worktreePrune()).catch(() => undefined)
  }
}
