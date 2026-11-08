import { fail } from '@shared/errors'
import type { Git } from './changes'
import { parseStatus } from './git-commands'

/**
 * The Changes tab's writing actions (ADR 0060): commit everything, push the branch, discard files.
 * Kept apart from WorktreeChanges, which only reads. Every path goes to Git as a literal pathspec
 * from the repository's top, so a name is never read as a pattern or an option.
 */

const top = (path: string): string => `:(top,literal)${path}`
const stderrOf = (error: unknown): string =>
  error instanceof Error && 'stderr' in error ? String((error as { stderr: unknown }).stderr) : String(error)
/** Git's own complaint: its first "error:"/"fatal:" line (else its first line), without the prefix. */
const gitSays = (error: unknown): string => {
  const lines = stderrOf(error).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const line = lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines[0]
  return line?.replace(/^(fatal|error):\s*/i, '') ?? 'Git refused.'
}

export const MAX_COMMIT_MESSAGE = 5000

/** Stages every change (untracked files included) and commits it; returns the new commit's sha. */
export async function commitAll(git: Git, message: string): Promise<string> {
  const text = message.trim()
  if (!text) fail('INVALID_INPUT', 'Write a commit message first.')
  if (text.length > MAX_COMMIT_MESSAGE) fail('INVALID_INPUT', 'That commit message is too long.')
  await git(['add', '-A', '--', ':(top)'])
  if (!(await git(['status', '--porcelain', '--', ':(top)'])).trim()) fail('INVALID_INPUT', 'There is nothing to commit.')
  try {
    await git(['commit', '--quiet', '-m', text])
  } catch (error) {
    fail('GIT_FAILED', gitSays(error), {
      operation: 'Commit',
      hint: /user\.(name|email)|identity/i.test(gitSays(error)) ? 'Set your Git name and email (git config --global user.name / user.email).' : undefined
    })
  }
  return (await git(['rev-parse', 'HEAD'])).trim()
}

/** Pushes the branch; a branch without an upstream goes to origin under its own name and tracks it. */
export async function pushBranch(git: Git): Promise<{ branch: string; upstream: string }> {
  const status = parseStatus(await git(['status', '--porcelain=v2', '--branch']))
  if (!status.branch) fail('INVALID_INPUT', 'This worktree is not on a branch.', { operation: 'Push' })
  const branch = status.branch!
  try {
    if (status.upstream) await git(['push', '--quiet'])
    else {
      const remotes = (await git(['remote'])).split(/\s+/).filter(Boolean)
      if (!remotes.includes('origin')) fail('INVALID_INPUT', 'This repository has no "origin" remote to push to.', { operation: 'Push' })
      await git(['push', '--quiet', '-u', 'origin', branch])
    }
  } catch (error) {
    if (error instanceof Error && !('stderr' in error)) throw error
    fail('GIT_FAILED', gitSays(error), { operation: 'Push', hint: /rejected|fetch first|non-fast-forward/i.test(stderrOf(error)) ? 'The remote has commits you do not: pull them first.' : undefined })
  }
  return { branch, upstream: status.upstream ?? `origin/${branch}` }
}

/**
 * Puts files back as they are in HEAD: a changed or deleted file is restored, a file HEAD does not
 * have (new, or a rename's new name) is removed. Ignored files are never touched.
 */
export async function discardFiles(git: Git, paths: string[]): Promise<void> {
  // Only paths inside the repository, as the Changes tab lists them: never absolute, never climbing out.
  if (paths.some((p) => !p || /^([/\\]|[A-Za-z]:)/.test(p) || p.split(/[/\\]/).includes('..'))) fail('INVALID_INPUT', 'That file is not inside this worktree.')
  const unique = [...new Set(paths)]
  if (!unique.length) return
  const inHead: string[] = []
  const fresh: string[] = []
  for (const path of unique) {
    // `HEAD:<path>` is read from the repository's top; it fails for a path HEAD lacks (or no HEAD yet).
    const known = await git(['cat-file', '-e', `HEAD:${path}`]).then(
      () => true,
      () => false
    )
    ;(known ? inHead : fresh).push(path)
  }
  if (inHead.length) await git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...inHead.map(top)])
  if (fresh.length) {
    await git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', ...fresh.map(top)])
    await git(['clean', '-f', '-q', '--', ...fresh.map(top)])
  }
}
