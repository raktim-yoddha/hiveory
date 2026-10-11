import { AppException } from '@shared/errors'
import type { GithubStatus, PullRequest } from '@shared/domain/github'
import type { HostAccount, Issue } from '@shared/domain/integrations'
import type { GitService } from './git-service'
import { gitArgs } from './git-commands'
import { hostCli, reasonOf, urlIn, type CodeHost, type HostCli } from './code-host'

/** Merge requests and issues via the GitLab CLI (`glab`, ADR 0040): gitlab.com or the user's own instance, as glab is set up. */
export class GitlabService implements CodeHost {
  readonly id = 'gitlab' as const

  constructor(
    private readonly git: GitService,
    private readonly glab: HostCli = hostCli('gitlab')
  ) {}

  async account(): Promise<HostAccount> {
    try {
      const user = JSON.parse(await this.glab(process.cwd(), ['api', 'user'], 15_000)) as { username?: string }
      return { available: true, login: user.username }
    } catch (error) {
      return { available: false, reason: reasonOf(error, 'Run "glab auth login".') }
    }
  }

  async avatarUrl(repoRoot: string | undefined): Promise<string | undefined> {
    // The project's own avatar, else its group's or owner's, else the signed-in account's.
    if (repoRoot) {
      try {
        const repo = JSON.parse(await this.glab(repoRoot, ['repo', 'view', '--output', 'json'], 15_000)) as { avatar_url?: string | null; namespace?: { avatar_url?: string | null } }
        const url = repo.avatar_url || repo.namespace?.avatar_url
        if (url) return url
      } catch {
        // Not on GitLab, or glab is not signed in: try the account.
      }
    }
    try {
      return (JSON.parse(await this.glab(process.cwd(), ['api', 'user'], 15_000)) as { avatar_url?: string | null }).avatar_url || undefined
    } catch {
      return undefined
    }
  }

  async status(repoRoot: string): Promise<GithubStatus> {
    try {
      const repo = JSON.parse(await this.glab(repoRoot, ['repo', 'view', '--output', 'json'], 15_000)) as { path_with_namespace: string; web_url: string; default_branch?: string }
      return { available: true, host: 'gitlab', repository: repo.path_with_namespace, url: repo.web_url, defaultBranch: repo.default_branch || undefined }
    } catch (error) {
      return { available: false, host: 'gitlab', reason: reasonOf(error, 'This repository is not connected to GitLab.') }
    }
  }

  async pullRequests(repoRoot: string): Promise<PullRequest[]> {
    const out = await this.glab(repoRoot, ['mr', 'list', '--output', 'json', '--per-page', '50'])
    return (JSON.parse(out) as Array<Record<string, unknown>>).map((m) => ({
      number: m.iid as number,
      title: m.title as string,
      branch: m.source_branch as string,
      url: m.web_url as string,
      draft: Boolean(m.draft ?? m.work_in_progress),
      updatedAt: m.updated_at as string,
      author: ((m.author as { username?: string } | null)?.username ?? '') as string
    }))
  }

  async issues(repoRoot: string): Promise<Issue[]> {
    const out = await this.glab(repoRoot, ['issue', 'list', '--output', 'json', '--per-page', '50'])
    return (JSON.parse(out) as Array<{ iid: number; title: string; web_url: string; state?: string }>).map((i) => ({ key: `#${i.iid}`, title: i.title, url: i.web_url, state: i.state }))
  }

  async createPullRequest(repoRoot: string, worktreePath: string, branch: string, draft: boolean): Promise<string> {
    await this.git.run(worktreePath, gitArgs.pushBranch(branch))
    const out = await this.glab(worktreePath, ['mr', 'create', '--source-branch', branch, '--fill', '--yes', ...(draft ? ['--draft'] : [])], 60_000)
    const url = urlIn(out)
    if (!url) throw new AppException({ code: 'GIT_FAILED', message: 'The merge request was not created.', detail: out })
    return url
  }
}
