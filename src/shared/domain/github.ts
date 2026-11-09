import type { CodeHostId } from './integrations'

/** A Workspace's code host and repository (GitHub or GitLab, ADR 0040; the name stays from when it was GitHub only). */
export interface GithubStatus {
  available: boolean
  /** Which host answered; absent when the Workspace has none. */
  host?: CodeHostId
  /** The repository's default branch on the host: reviews come from any other branch. */
  defaultBranch?: string
  repository?: string
  url?: string
  /** Why pull requests are unavailable (gh missing, not signed in, no GitHub remote…). */
  reason?: string
}

/** A pull request (GitHub) or merge request (GitLab). */
export interface PullRequest {
  number: number
  title: string
  branch: string
  url: string
  draft: boolean
  updatedAt: string
  author: string
  reviewDecision?: string
}

export interface GithubIssue {
  number: number
  title: string
  url: string
}

/** What the create dialog needs to offer Git options for a project. */
export interface GitInfo {
  isRepo: boolean
  hasCommits: boolean
  defaultBranch?: string
  currentBranch?: string
  branches: string[]
  /** Branches already checked out in some worktree (cannot be reused). */
  branchesInUse: string[]
  /** Remote-tracking branches (origin/x), newest first. */
  remoteBranches: string[]
  /** Asked to fetch, but origin could not be reached (the list may be stale). */
  fetchFailed?: boolean
}

/** How one check on a review is doing (a CI job, a status). */
export type CheckState = 'success' | 'failure' | 'pending' | 'skipped' | 'neutral'

export interface PullRequestCheck {
  name: string
  /** Its workflow or pipeline, when the host says. */
  group?: string
  state: CheckState
  /** How long it ran, when finished. */
  seconds?: number
  url?: string
}

/** The review of one branch, with its checks (ADR 0064). */
export interface PullRequestDetail extends PullRequest {
  state: 'open' | 'merged' | 'closed'
  baseBranch?: string
  /** False when it has conflicts; absent while the host is still working it out. */
  mergeable?: boolean
  checks: PullRequestCheck[]
}

export type MergeMethod = 'squash' | 'merge' | 'rebase'
