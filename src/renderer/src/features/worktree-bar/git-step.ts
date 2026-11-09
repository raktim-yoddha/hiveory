import type { PullRequestDetail } from '@shared/domain/github'
import type { GitStatusView } from '@shared/ipc/contract'

/** The worktree's next git step, which the bar's git button offers first (ADR 0064). */
export type GitStep = 'commit' | 'publish' | 'push' | 'create-pr' | 'merge' | 'none'

/**
 * Commit while anything is uncommitted; then publish a branch that has no upstream, or push commits
 * not on it yet; then open a pull request, or merge the open one. `pr` is undefined until it is known;
 * the Primary never suggests a pull request of its own (it is usually on the default branch).
 */
export function nextGitStep(status: GitStatusView | null, pr: PullRequestDetail | null | undefined, isPrimary: boolean): GitStep {
  if (!status) return 'none'
  if (status.changed + status.untracked > 0) return 'commit'
  if (!status.branch) return 'none'
  if (!status.upstream && !isPrimary) return 'publish'
  if (status.upstream && status.ahead > 0) return 'push'
  if (pr?.state === 'open') return 'merge'
  if (pr === null && !isPrimary) return 'create-pr'
  return 'none'
}
