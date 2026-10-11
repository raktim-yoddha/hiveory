import { AppException } from '@shared/errors'
import type { GithubStatus, PullRequest } from '@shared/domain/github'
import type { HostAccount, Issue } from '@shared/domain/integrations'
import type { GitService } from './git-service'
import { gitArgs } from './git-commands'
import { hostCli, reasonOf, urlIn, type CodeHost, type HostCli } from './code-host'

/** Pull requests and issues via the GitHub CLI (`gh`), optional: everything else works without it. */
export class GithubService implements CodeHost {
  readonly id = 'github' as const

  constructor(
    private readonly git: GitService,
    private readonly gh: HostCli = hostCli('github')
  ) {}

  async account(): Promise<HostAccount> {
    try {
      return { available: true, login: (await this.gh(process.cwd(), ['api', 'user', '--jq', '.login'], 15_000)).trim() }
    } catch (error) {
      return { available: false, reason: reasonOf(error, 'Run "gh auth login".') }
    }
  }

  async status(repoRoot: string): Promise<GithubStatus> {
    try {
      const out = await this.gh(repoRoot, ['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef'], 15_000)
      const repo = JSON.parse(out) as { nameWithOwner: string; url: string; defaultBranchRef?: { name?: string } | null }
      return { available: true, host: 'github', repository: repo.nameWithOwner, url: repo.url, defaultBranch: repo.defaultBranchRef?.name || undefined }
    } catch (error) {
      return { available: false, host: 'github', reason: reasonOf(error, 'This repository is not connected to GitHub.') }
    }
  }

  async pullRequests(repoRoot: string): Promise<PullRequest[]> {
    const out = await this.gh(repoRoot, ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,headRefName,url,isDraft,updatedAt,author,reviewDecision'])
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

  async issues(repoRoot: string): Promise<Issue[]> {
    const out = await this.gh(repoRoot, ['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,url'])
    return (JSON.parse(out) as Array<{ number: number; title: string; url: string }>).map((i) => ({ key: `#${i.number}`, title: i.title, url: i.url }))
  }

  async createPullRequest(repoRoot: string, worktreePath: string, branch: string, draft: boolean): Promise<string> {
    await this.git.run(worktreePath, gitArgs.pushBranch(branch))
    const out = await this.gh(worktreePath, ['pr', 'create', '--head', branch, '--fill', ...(draft ? ['--draft'] : [])], 60_000)
    const url = urlIn(out)
    if (!url) throw new AppException({ code: 'GIT_FAILED', message: 'The pull request was not created.', detail: out })
    return url
  }
}
