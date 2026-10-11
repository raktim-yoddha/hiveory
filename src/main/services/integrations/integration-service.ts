import { codeHostOf, TRACKER_INFO, type CodeHostId, type IntegrationsView, type IssueList } from '@shared/domain/integrations'
import type { Project } from '@shared/domain'
import { AppException } from '@shared/errors'
import type { CodeHost } from '../git/code-host'
import { reasonOf } from '../git/code-host'
import type { GitService } from '../git/git-service'
import type { TrackerService } from './tracker-service'

/**
 * Which code host and issue source a Workspace uses (ADR 0040). Its settings decide; without one the
 * origin remote tells the code host (GitLab when its address says so, else GitHub) and issues come
 * from that host.
 */
export class IntegrationService {
  constructor(
    private readonly git: GitService,
    private readonly hosts: Record<CodeHostId, CodeHost>,
    readonly trackers: TrackerService
  ) {}

  /** The Workspace's code host; null when it is turned off. */
  async hostFor(project: Project, repoRoot: string): Promise<CodeHost | null> {
    const chosen = project.settings?.codeHost
    if (chosen === 'none') return null
    return this.hosts[chosen ?? codeHostOf(await this.git.remoteUrl(repoRoot)) ?? 'github']
  }

  async status(): Promise<IntegrationsView> {
    const [github, gitlab] = await Promise.all([this.hosts.github.account(), this.hosts.gitlab.account()])
    return { hosts: { github, gitlab }, ...this.trackers.view() }
  }

  /** Open issues from wherever this Workspace's come from; a reason instead when there are none to show. */
  async issues(project: Project, repoRoot: string | undefined): Promise<IssueList> {
    const source = project.settings?.issueSource
    if (source === 'none') return { issues: [], reason: 'Issues are turned off for this workspace.' }
    if (source) {
      const { name, group } = TRACKER_INFO[source]
      if (!project.settings?.trackerGroup) return { source, issues: [], reason: `Pick a ${name} ${group.toLowerCase()} in this workspace's settings.` }
      try {
        return { source, issues: await this.trackers.issues(source, project.settings.trackerGroup) }
      } catch (error) {
        const app = error instanceof AppException ? error.error : undefined
        return { source, issues: [], reason: app ? [app.message, app.hint].filter(Boolean).join(' ') : `Could not load ${name} issues.` }
      }
    }
    if (!repoRoot) return { issues: [], reason: 'This workspace is not a Git repository.' }
    const host = await this.hostFor(project, repoRoot)
    if (!host) return { issues: [], reason: 'This workspace has no code host.' }
    try {
      return { source: host.id, issues: await host.issues(repoRoot) }
    } catch (error) {
      return { source: host.id, issues: [], reason: reasonOf(error, 'Could not load issues.') }
    }
  }
}
