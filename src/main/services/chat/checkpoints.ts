import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { TurnCheckpoint } from '@shared/domain/chat'
import { WorktreeChanges, type Git } from '../git/changes'

/**
 * A chat turn's checkpoints (ADR 0058, after T3 Code's): before and after each turn the worktree is
 * written to Git as a tree, through a copy of the index, so the user's index, branches and stash
 * never change. The turn's changes are the difference of the two trees; undoing a turn puts back
 * only the files that turn changed.
 *
 * ponytail: trees no ref points at live until `git gc` prunes them (two weeks by default), so an
 * older turn may no longer undo; anchor them under refs/hiveory/ if that ever matters.
 */
export class Checkpoints {
  constructor(
    private readonly gitIn: (cwd: string) => Git,
    private readonly tmpDir: string
  ) {}

  /** The folder as a tree, untracked files included (ignored ones left out); undefined outside a repository. */
  async snapshot(cwd: string): Promise<string | undefined> {
    const git = this.gitIn(cwd)
    let indexPath: string
    try {
      if ((await git(['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return undefined
      indexPath = (await git(['rev-parse', '--git-path', 'index'])).trim()
    } catch {
      return undefined
    }
    await mkdir(this.tmpDir, { recursive: true })
    const index = join(this.tmpDir, `index-${randomUUID()}`)
    // Starting from the real index keeps its file stats: only changed files are read again.
    await copyFile(isAbsolute(indexPath) ? indexPath : join(cwd, indexPath), index).catch(() => undefined)
    const env = { GIT_INDEX_FILE: index }
    try {
      await git(['add', '-A', '--ignore-errors', '--', '.'], { env })
      return (await git(['write-tree'], { env })).trim() || undefined
    } catch {
      return undefined
    } finally {
      await rm(index, { force: true }).catch(() => undefined)
    }
  }

  /** The turn's file changes, counted. */
  async measure(cwd: string, before: string, after: string): Promise<TurnCheckpoint> {
    const files = await new WorktreeChanges(this.gitIn(cwd)).between(before, after)
    return {
      before,
      after,
      files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0)
    }
  }

  /** Puts every file the turn changed back as it was before the turn; files it added are removed. */
  async revert(cwd: string, before: string, after: string): Promise<number> {
    const git = this.gitIn(cwd)
    const files = await new WorktreeChanges(git).between(before, after)
    // Paths are the repository's; the chat may work in a folder inside it.
    const top = (await git(['rev-parse', '--show-toplevel'])).trim()
    const restore = files.flatMap((f) => (f.status === 'added' ? [] : [`:(top,literal)${f.from ?? f.path}`]))
    const remove = files.flatMap((f) => (f.status === 'added' || f.status === 'renamed' ? [f.path] : []))
    if (restore.length) await git(['restore', `--source=${before}`, '--worktree', '--', ...restore])
    await Promise.all(remove.map((path) => rm(join(top, path), { force: true })))
    return files.length
  }
}
