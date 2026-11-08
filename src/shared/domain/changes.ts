/**
 * A worktree's changes for the side panel's Changes tab (ADR 0058): what the agents (and the user)
 * changed, read from Git on the machine the worktree lives on.
 */
export type ChangeSource =
  /** Everything not committed yet, untracked files included. */
  | { kind: 'uncommitted' }
  /** The branch against its base (merge base), committed and uncommitted. */
  | { kind: 'branch' }
  /** One commit against its first parent. */
  | { kind: 'commit'; sha: string }
  /** One chat turn: its checkpoint's trees. */
  | { kind: 'turn'; chatId: string; messageId: string }

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface ChangedFile {
  /** Relative to the worktree, with '/' separators. */
  path: string
  /** A renamed file's old path. */
  from?: string
  status: ChangeStatus
  additions: number
  deletions: number
  binary?: boolean
}

export interface ChangeSet {
  /** Absent when the folder is not a Git repository. */
  branch?: string
  /** What `branch` is compared against. */
  base?: string
  files: ChangedFile[]
  additions: number
  deletions: number
  /** Why there is nothing to list (not a repository, no base branch…). */
  note?: string
}

export interface CommitSummary {
  sha: string
  subject: string
  author: string
  /** ISO date. */
  date: string
}
