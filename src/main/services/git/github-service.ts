import { execFile } from 'node:child_process'
import { AppException } from '@shared/errors'
import type { GithubIssue, GithubStatus, PullRequest } from '@shared/domain/github'
import type { GitService } from './git-service'
import { gitArgs } from './git-commands'

/** Runs the GitHub CLI (`gh`) — a local tool the user already authenticated; Hiveory stores no tokens. */
const gh = (cwd: string, args: string[], timeout = 30_000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout.toString())
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      reject(
        new AppException({
          code: 'GIT_FAILED',
          message: missing ? 'The GitHub CLI (gh) is not installed.' : 'The GitHub CLI reported an error.',
          hint: missing ? 'Install gh and run "gh auth login" to enable pull requests.' : undefined,
          detail: stderr.toString().trim() || error.message
        })
      )
    })
  })

/** Pull requests and issues via `gh`, optional: everything else works without it. */
export class GithubService {
  constructor(private readonly git: GitService) {}

  async status(repoRoot: string): Promise<GithubStatus> {
    try {
      const out = await gh(repoRoot, ['repo', 'view', '--json', 'nameWithOwner,url'], 15_000)
      const repo = JSON.parse(out) as { nameWithOwner: string; url: string }
      return { available: true, repository: repo.nameWithOwner, url: repo.url }
    } catch (error) {
      const app = error instanceof AppException ? error.error : undefined
      return { available: false, reason: app?.hint ?? app?.detail ?? 'This repository is not connected to GitHub.' }
    }
  }

  async pullRequests(repoRoot: string): Promise<PullRequest[]> {
    const out = await gh(repoRoot, [
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '50',
      '--json',
      'number,title,headRefName,url,isDraft,updatedAt,author,reviewDecision'
    ])
    return (JSON.parse(out) as Array<Record<string, unknown>>).map((p) => ({
      number: p.number as number,
      title: p.title as string,
      branch: p.headRefName as string,
      url: p.url as string,
      draft: Boolean(p.isDraft),
      updatedAt: p.updatedAt as string,
      author: ((p.author as { login?: string } | null)?.login ?? '') as string,
      reviewDecision: (p.reviewDecision as string) || undefined
    }))
  }

  async issues(repoRoot: string): Promise<GithubIssue[]> {
    const out = await gh(repoRoot, ['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,url'])
    return JSON.parse(out) as GithubIssue[]
  }

  /** Pushes the workspace branch to origin, then opens a PR filled from its commits. */
  async createPullRequest(repoRoot: string, worktreePath: string, branch: string, draft: boolean): Promise<string> {
    await this.git.run(worktreePath, gitArgs.pushBranch(branch))
    const out = await gh(worktreePath, ['pr', 'create', '--head', branch, '--fill', ...(draft ? ['--draft'] : [])], 60_000)
    const url = out.trim().split(/\s+/).find((t) => t.startsWith('https://'))
    if (!url) throw new AppException({ code: 'GIT_FAILED', message: 'The pull request was not created.', detail: out })
    return url
  }
}
