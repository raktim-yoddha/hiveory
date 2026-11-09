import { execFile } from 'node:child_process'
import { AppException } from '@shared/errors'
import type { GithubStatus, MergeMethod, PullRequest, PullRequestDetail } from '@shared/domain/github'
import { CODE_HOST_INFO, type CodeHostId, type HostAccount, type Issue } from '@shared/domain/integrations'

/** Runs a code host CLI (gh, glab): local tools the user already signed in to; Hiveory stores no tokens. No shell. */
export type HostCli = (cwd: string, args: string[], timeout?: number) => Promise<string>

export const hostCli =
  (host: CodeHostId): HostCli =>
  (cwd, args, timeout = 30_000) =>
    new Promise((resolve, reject) => {
      const { cli, name, signIn } = CODE_HOST_INFO[host]
      execFile(cli, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout.toString())
        const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
        reject(
          new AppException({
            code: 'GIT_FAILED',
            message: missing ? `The ${name} CLI (${cli}) is not installed.` : `The ${name} CLI reported an error.`,
            hint: missing ? `Install ${cli} and run "${signIn}".` : undefined,
            detail: stderr.toString().trim() || error.message
          })
        )
      })
    })

/** The CLI's own words when it failed (its stderr), for telling "no review" apart from a real error. */
export const detailOf = (error: unknown): string => (error instanceof AppException ? (error.error.detail ?? error.error.message) : String(error))

/** Why a host CLI call failed, in the words its status shows. */
export const reasonOf = (error: unknown, fallback: string): string => {
  const app = error instanceof AppException ? error.error : undefined
  return app?.hint ?? (app?.detail ? readable(app.detail) : fallback)
}

/** What the CLIs say most often, in the app's words (ADR 0065). */
const KNOWN: Array<[RegExp, string]> = [
  [/no git remotes? found|none of the git remotes/i, 'This repository has no GitHub or GitLab remote yet.'],
  [/could not resolve host|network is unreachable|timed? ?out/i, 'The code host could not be reached. Check the connection.'],
  [/not (?:logged|signed) in|authentication (?:required|failed)|bad credentials|http 401/i, 'The code host CLI is not signed in.']
]

/** A CLI's message as a sentence: its first line, a known one reworded, capitalized and ended. */
export const readable = (detail: string): string => {
  const line = detail.trim().split(/\r?\n/)[0]!.replace(/^(?:error|fatal|gh|glab):\s*/i, '').trim()
  const known = KNOWN.find(([pattern]) => pattern.test(line))
  if (known) return known[1]
  if (!line) return detail
  const sentence = line[0]!.toUpperCase() + line.slice(1)
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}

/** The first https address in a CLI's output (the review it just opened). */
export const urlIn = (out: string): string | undefined => out.trim().split(/\s+/).find((t) => t.startsWith('https://'))

/** One code host's reviews and issues for a checkout (ADR 0040). GitHub calls them pull requests, GitLab merge requests. */
export interface CodeHost {
  readonly id: CodeHostId
  account(): Promise<HostAccount>
  status(repoRoot: string): Promise<GithubStatus>
  pullRequests(repoRoot: string): Promise<PullRequest[]>
  issues(repoRoot: string): Promise<Issue[]>
  /** Pushes the branch to origin, then opens a review filled from its commits; returns its address. */
  createPullRequest(repoRoot: string, worktreePath: string, branch: string, draft: boolean): Promise<string>
  /** The review of `branch` with its checks, or null when it has none (ADR 0064). Run in the worktree. */
  pullRequestFor(worktreePath: string, branch: string): Promise<PullRequestDetail | null>
  /** Merges review `number` on the host (the user asked for it with Merge). */
  merge(worktreePath: string, number: number, method: MergeMethod): Promise<void>
  /** The repository owner's avatar (its project's, on GitLab), else the signed-in account's; an https address. */
  avatarUrl(repoRoot: string | undefined): Promise<string | undefined>
}
