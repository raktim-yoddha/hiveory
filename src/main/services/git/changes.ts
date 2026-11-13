import { createReadStream } from 'node:fs'
import type { ChangedFile, ChangeSet, ChangeStatus, CommitSummary } from '@shared/domain/changes'

/**
 * Runs git in one folder and returns stdout. `ok` lists extra exit codes that are not failures
 * (`git diff --no-index` exits 1 when the files differ).
 */
export type Git = (args: string[], options?: { env?: Record<string, string>; ok?: number[] }) => Promise<string>

/** Git's well-known empty tree: the base of a repository without commits. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** Untracked files counted line by line; past this they are listed without counts. */
const MAX_COUNTED_UNTRACKED = 200
const MAX_COMMITS = 100
const NULL_PATH = '/dev/null'

const STATUS: Record<string, ChangeStatus> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified', U: 'modified' }
const slash = (path: string): string => path.replace(/\\/g, '/')
/** A repository-relative path as a pathspec, whatever folder git runs in. */
const top = (path: string): string => `:(top,literal)${path}`

/** `--name-status -z`: "M\0path\0", "R100\0old\0new\0". */
export const parseNameStatus = (out: string): Array<{ path: string; from?: string; status: ChangeStatus }> => {
  const parts = out.split('\0')
  const files: Array<{ path: string; from?: string; status: ChangeStatus }> = []
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++]?.trim()
    if (!code) continue
    const status = STATUS[code[0]!] ?? 'modified'
    if (code[0] === 'R' || code[0] === 'C') {
      const from = parts[i++] ?? ''
      const path = parts[i++] ?? ''
      files.push(code[0] === 'R' ? { path: slash(path), from: slash(from), status } : { path: slash(path), status })
    } else {
      files.push({ path: slash(parts[i++] ?? ''), status })
    }
  }
  return files.filter((f) => f.path)
}

/** `--numstat -z`: "3\t1\tpath\0", renames "3\t1\t\0old\0new\0", binary "-\t-\tpath\0". */
export const parseNumstat = (out: string): Map<string, { additions: number; deletions: number; binary: boolean }> => {
  const counts = new Map<string, { additions: number; deletions: number; binary: boolean }>()
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; ) {
    const head = parts[i++] ?? ''
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(head.replace(/^\n/, ''))
    if (!match) continue
    let path = match[3] ?? ''
    if (!path) {
      i++ // the old path of a rename
      path = parts[i++] ?? ''
    }
    const binary = match[1] === '-'
    counts.set(slash(path), { additions: binary ? 0 : Number(match[1]), deletions: binary ? 0 : Number(match[2]), binary })
  }
  return counts
}

/** Joins name-status and numstat into the files of a change set, sorted by path. */
export const mergeChanges = (names: ReturnType<typeof parseNameStatus>, counts: ReturnType<typeof parseNumstat>): ChangedFile[] =>
  names
    .map((n) => {
      const c = counts.get(n.path)
      return { ...n, additions: c?.additions ?? 0, deletions: c?.deletions ?? 0, ...(c?.binary ? { binary: true } : {}) }
    })
    .sort((a, b) => a.path.localeCompare(b.path))

export const totals = (files: ChangedFile[]): Pick<ChangeSet, 'additions' | 'deletions'> => ({
  additions: files.reduce((n, f) => n + f.additions, 0),
  deletions: files.reduce((n, f) => n + f.deletions, 0)
})

/**
 * Most files a change set lists (ADR 0064 amendment). A folder inside a much larger repository (or
 * one without a .gitignore) can have a hundred thousand untracked files: sent whole they froze the
 * window for most of a minute. The window draws 1,000 rows in about 0.4 s; past that they are
 * counted, not listed.
 */
export const MAX_LISTED_FILES = 1000

/** The files of a change set as sent: the first MAX_LISTED_FILES, totals over all of them. */
export const listed = (files: ChangedFile[]): Pick<ChangeSet, 'files' | 'additions' | 'deletions' | 'omitted'> => ({
  files: files.length > MAX_LISTED_FILES ? files.slice(0, MAX_LISTED_FILES) : files,
  ...totals(files),
  ...(files.length > MAX_LISTED_FILES ? { omitted: files.length - MAX_LISTED_FILES } : {})
})

/** Git calls a file binary when its first 8,000 bytes hold a NUL (xdiff's buffer_is_binary). */
const BINARY_PROBE = 8000

/**
 * An untracked file's lines, as `git diff --no-index --numstat` counts them, read here instead:
 * starting a git process per file blocked the main process for about 16 ms each on Windows, 3 s
 * for 200 files, and the whole app with it (ADR 0064 amendment).
 */
export const countNewFile = (path: string): Promise<{ additions: number; binary?: true }> =>
  new Promise((resolve) => {
    let lines = 0
    let read = 0
    let last = 10
    const stream = createReadStream(path)
    stream.on('data', (chunk: Buffer) => {
      if (read < BINARY_PROBE && chunk.subarray(0, BINARY_PROBE - read).includes(0)) {
        stream.destroy()
        return resolve({ additions: 0, binary: true })
      }
      read += chunk.length
      for (let at = chunk.indexOf(10); at >= 0; at = chunk.indexOf(10, at + 1)) lines++
      last = chunk[chunk.length - 1] ?? last
    })
    // A last line without a line end still counts.
    stream.on('end', () => resolve({ additions: lines + (read > 0 && last !== 10 ? 1 : 0) }))
    stream.on('error', () => resolve({ additions: 0 }))
  })

/** `git log --format=%H%x1f%s%x1f%an%x1f%aI%x1e`. */
export const parseLog = (out: string): CommitSummary[] =>
  out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha = '', subject = '', author = '', date = ''] = r.split('\x1f')
      return { sha, subject, author, date }
    })

/**
 * Reads a worktree's changes from Git (ADR 0058). The same calls run on this computer or on the
 * project's SSH host; nothing here touches the user's index, branches or files.
 */
export class WorktreeChanges {
  private root?: Promise<string>

  constructor(private readonly git: Git) {}

  /** The repository's top folder (Git reports paths from there, even when it runs in a folder inside). */
  private toplevel(): Promise<string> {
    this.root ??= this.git(['rev-parse', '--show-toplevel']).then((out) => out.trim())
    return this.root
  }

  private async tryGit(args: string[]): Promise<string | undefined> {
    try {
      return (await this.git(args)).trim()
    } catch {
      return undefined
    }
  }

  async branch(): Promise<string | undefined> {
    return (await this.tryGit(['branch', '--show-current'])) || (await this.tryGit(['rev-parse', '--short', 'HEAD']))
  }

  /** HEAD, or the empty tree in a repository without commits; undefined outside a repository. */
  async head(): Promise<string | undefined> {
    if ((await this.tryGit(['rev-parse', '--is-inside-work-tree'])) !== 'true') return undefined
    return (await this.tryGit(['rev-parse', '--verify', '--quiet', 'HEAD'])) || EMPTY_TREE
  }

  /** Where the branch left `base` (its merge base), or undefined when there is no such branch. */
  async mergeBase(base: string): Promise<string | undefined> {
    if (base.startsWith('-')) return undefined
    return this.tryGit(['merge-base', 'HEAD', base])
  }

  /** `from` (a commit or tree) against the working folder, untracked files included. */
  async againstWorktree(from: string): Promise<ChangedFile[]> {
    const [names, counts, untracked] = await Promise.all([
      this.git(['diff', '--name-status', '-z', '-M', from, '--']),
      this.git(['diff', '--numstat', '-z', '-M', from, '--']),
      this.git(['ls-files', '--others', '--exclude-standard', '--full-name', '-z', '--', ':(top)'])
    ])
    const root = await this.toplevel()
    const tracked = mergeChanges(parseNameStatus(names), parseNumstat(counts))
    const added = untracked.split('\0').filter(Boolean).map(slash)
    const extra = await Promise.all(
      added.map(async (path, i): Promise<ChangedFile> => {
        if (i >= MAX_COUNTED_UNTRACKED) return { path, status: 'added', additions: 0, deletions: 0 }
        const c = await countNewFile(`${root}/${path}`)
        return { path, status: 'added', additions: c.additions, deletions: 0, ...(c.binary ? { binary: true } : {}) }
      })
    )
    return [...tracked, ...extra].sort((a, b) => a.path.localeCompare(b.path))
  }

  /** Between two commits or trees. */
  async between(from: string, to: string): Promise<ChangedFile[]> {
    const [names, counts] = await Promise.all([
      this.git(['diff', '--name-status', '-z', '-M', from, to, '--']),
      this.git(['diff', '--numstat', '-z', '-M', from, to, '--'])
    ])
    return mergeChanges(parseNameStatus(names), parseNumstat(counts))
  }

  /** One commit against its first parent (the root commit against nothing). */
  async commit(sha: string): Promise<ChangedFile[]> {
    const [names, counts] = await Promise.all([
      this.git(['diff-tree', '-r', '--root', '--no-commit-id', '-M', '--name-status', '-z', sha]),
      this.git(['diff-tree', '-r', '--root', '--no-commit-id', '-M', '--numstat', '-z', sha])
    ])
    return mergeChanges(parseNameStatus(names), parseNumstat(counts))
  }

  /** A unified diff of one file: from `from` to the working folder (untracked files as new). */
  async fileAgainstWorktree(from: string, path: string, untracked: boolean): Promise<string> {
    if (untracked) return this.git(['diff', '--no-index', '--', NULL_PATH, `${await this.toplevel()}/${path}`], { ok: [1] })
    return this.git(['diff', '-M', from, '--', top(path)])
  }

  fileBetween(from: string, to: string, path: string): Promise<string> {
    return this.git(['diff', '-M', from, to, '--', top(path)])
  }

  fileInCommit(sha: string, path: string): Promise<string> {
    return this.git(['diff-tree', '-p', '-r', '--root', '--no-commit-id', '-M', sha, '--', top(path)])
  }

  async isUntracked(path: string): Promise<boolean> {
    return (await this.tryGit(['ls-files', '--others', '--exclude-standard', '--full-name', '--', top(path)])) === path
  }

  async commits(range?: string): Promise<CommitSummary[]> {
    const out = await this.tryGit(['log', `-${MAX_COMMITS}`, '--format=%H%x1f%s%x1f%an%x1f%aI%x1e', ...(range ? [range] : [])])
    return out ? parseLog(out) : []
  }
}
