/** Pure Git argument builders and output parsers, kept separate so they are unit-testable. */

export const gitArgs = {
  topLevel: () => ['rev-parse', '--show-toplevel'],
  currentBranch: () => ['branch', '--show-current'],
  hasCommits: () => ['rev-parse', '--verify', '--quiet', 'HEAD'],
  /** Resolves any ref (branch, remote branch, tag) to a commit. */
  verifyCommit: (ref: string) => ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
  remoteHead: () => ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
  localBranchExists: (branch: string) => ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
  worktreeAdd: (path: string, branch: string, baseRef: string) => ['worktree', 'add', '-b', branch, path, baseRef],
  /** Checks an existing local branch out into a new linked worktree. */
  worktreeAddExisting: (path: string, branch: string) => ['worktree', 'add', path, branch],
  worktreeRemove: (path: string, force: boolean) => ['worktree', 'remove', ...(force ? ['--force'] : []), path],
  worktreeList: () => ['worktree', 'list', '--porcelain'],
  worktreePrune: () => ['worktree', 'prune'],
  worktreeRepair: (path: string) => ['worktree', 'repair', path],
  deleteMergedBranch: (branch: string) => ['branch', '-d', branch],
  localBranches: () => ['for-each-ref', '--format=%(refname:short)', '--sort=-committerdate', 'refs/heads'],
  checkBranchName: (name: string) => ['check-ref-format', '--branch', name],
  status: () => ['status', '--porcelain=v2', '--branch'],
  init: () => ['init'],
  addAll: () => ['add', '-A'],
  initialCommit: () => ['commit', '--allow-empty', '-m', 'Initial commit'],
  pushBranch: (branch: string) => ['push', '-u', 'origin', branch]
}

export interface GitStatus {
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  /** Tracked files with staged or unstaged changes (including conflicts). */
  changed: number
  untracked: number
}

/** Parses `git status --porcelain=v2 --branch`. */
export const parseStatus = (output: string): GitStatus => {
  const status: GitStatus = { ahead: 0, behind: 0, changed: 0, untracked: 0 }
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice(14).trim()
      if (head !== '(detached)') status.branch = head
    } else if (line.startsWith('# branch.upstream ')) status.upstream = line.slice(18).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        status.ahead = Number(m[1])
        status.behind = Number(m[2])
      }
    } else if (/^[12u] /.test(line)) status.changed++
    else if (line.startsWith('? ')) status.untracked++
  }
  return status
}

/** Our own conservative rules on top of `git check-ref-format`: readable, no surprises. */
export const branchNameProblem = (name: string): string | null => {
  if (!name.trim()) return 'Enter a branch name.'
  if (name.length > 120) return 'Branch name is too long.'
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return 'Use letters, numbers, dots, dashes, underscores and slashes only.'
  if (/(^[/.-])|([/.]$)|\.\.|\/\/|@\{|\.lock(\/|$)/.test(name)) return 'That is not a valid Git branch name.'
  return null
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

/** `git worktree add` refuses a branch that is checked out elsewhere. */
export const isBranchInUseError = (stderr: string): boolean => /already (checked out|used by worktree)/i.test(stderr)
