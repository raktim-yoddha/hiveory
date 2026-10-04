export interface GithubStatus {
  available: boolean
  repository?: string
  url?: string
  /** Why pull requests are unavailable (gh missing, not signed in, no GitHub remote…). */
  reason?: string
}

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
}
