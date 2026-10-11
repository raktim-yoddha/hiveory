import { execFile } from 'node:child_process'
import { AppException } from '@shared/errors'
import type { GithubStatus, PullRequest } from '@shared/domain/github'
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

/** Why a host CLI call failed, in the words its status shows. */
export const reasonOf = (error: unknown, fallback: string): string => {
  const app = error instanceof AppException ? error.error : undefined
  return app?.hint ?? app?.detail ?? fallback
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
}
