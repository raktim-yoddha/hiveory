/** Pure Git argument builders and output parsers, kept separate so they are unit-testable. */

export const gitArgs = {
  topLevel: () => ['rev-parse', '--show-toplevel'],
  currentBranch: () => ['branch', '--show-current'],
  hasCommits: () => ['rev-parse', '--verify', '--quiet', 'HEAD'],
  remoteHead: () => ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
  localBranchExists: (branch: string) => ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
  worktreeAdd: (path: string, branch: string, baseRef: string) => ['worktree', 'add', '-b', branch, path, baseRef],
  worktreeRemove: (path: string, force: boolean) => ['worktree', 'remove', ...(force ? ['--force'] : []), path],
  worktreeList: () => ['worktree', 'list', '--porcelain'],
  worktreePrune: () => ['worktree', 'prune'],
  deleteMergedBranch: (branch: string) => ['branch', '-d', branch]
}

export interface WorktreeEntry {
  path: string
  head?: string
  branch?: string
  detached: boolean
  bare: boolean
}

/** Parses `git worktree list --porcelain`. The first entry is the main worktree. */
export const parseWorktreeList = (output: string): WorktreeEntry[] =>
  output
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).filter(Boolean))
    .filter((lines) => lines.length > 0 && lines[0]?.startsWith('worktree '))
    .map((lines) => {
      const entry: WorktreeEntry = { path: '', detached: false, bare: false }
      for (const line of lines) {
        const [key, ...rest] = line.split(' ')
        const value = rest.join(' ')
        if (key === 'worktree') entry.path = value
        else if (key === 'HEAD') entry.head = value
        else if (key === 'branch') entry.branch = value.replace(/^refs\/heads\//, '')
        else if (key === 'detached') entry.detached = true
        else if (key === 'bare') entry.bare = true
      }
      return entry
    })

/** `origin/main` → `main`. */
export const stripRemote = (ref: string): string => ref.replace(/^[^/]+\//, '')

export const isDirtyWorktreeError = (stderr: string): boolean =>
  /contains modified or untracked files|is dirty|use --force to delete/i.test(stderr)

export const isUnmergedBranchError = (stderr: string): boolean => /not fully merged/i.test(stderr)
