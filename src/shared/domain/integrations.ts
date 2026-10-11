/**
 * Code hosts and issue trackers (ADR 0040). Code hosts run the user's own signed-in CLI (gh, glab);
 * trackers use a key the user pastes in Settings › Integrations, sealed in main and never sent to the
 * renderer, a model or another service.
 */

export const CODE_HOSTS = ['github', 'gitlab'] as const
export type CodeHostId = (typeof CODE_HOSTS)[number]

export const TRACKERS = ['jira', 'linear'] as const
export type TrackerId = (typeof TRACKERS)[number]

/** What the UI says about each code host. */
export const CODE_HOST_INFO: Record<CodeHostId, { name: string; cli: string; review: string; reviews: string; signIn: string }> = {
  github: { name: 'GitHub', cli: 'gh', review: 'pull request', reviews: 'Pull requests', signIn: 'gh auth login' },
  gitlab: { name: 'GitLab', cli: 'glab', review: 'merge request', reviews: 'Merge requests', signIn: 'glab auth login' }
}

export const TRACKER_INFO: Record<TrackerId, { name: string; group: string }> = {
  jira: { name: 'Jira', group: 'Project' },
  linear: { name: 'Linear', group: 'Team' }
}

/** The code host a remote URL points at: GitLab when its address says so, otherwise GitHub (gh also serves GitHub Enterprise). */
export const codeHostOf = (remoteUrl: string | undefined): CodeHostId | undefined => {
  if (!remoteUrl) return undefined
  return /gitlab/i.test(remoteUrl) ? 'gitlab' : 'github'
}

/** One issue from wherever the Workspace's issues come from. `key`: "#12", "ENG-42", "WEB-7". */
export interface Issue {
  key: string
  title: string
  url: string
  /** The tracker's own state name ("In Progress", "opened"). */
  state?: string
}

export interface IssueList {
  /** Where they came from; undefined when this Workspace has no issue source. */
  source?: CodeHostId | TrackerId
  issues: Issue[]
  /** Why there are none to show (not connected, no project chosen, the service said no). */
  reason?: string
}

/** A code host CLI's sign-in on this computer. */
export interface HostAccount {
  available: boolean
  /** The signed-in user name. */
  login?: string
  reason?: string
}

/** Settings › Integrations. Tracker keys never appear here, only that one is saved. */
export interface IntegrationsView {
  hosts: Record<CodeHostId, HostAccount>
  jira?: { site: string; email: string }
  linear?: { connected: true }
}

/** A Jira project or Linear team, for a Workspace's issue source. */
export interface TrackerGroup {
  key: string
  name: string
}

/** Turns "acme.atlassian.net" or "https://acme.atlassian.net/jira/..." into "https://acme.atlassian.net"; undefined when it isn't a site. */
export const jiraSiteOf = (input: string): string | undefined => {
  const text = input.trim()
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    if (url.protocol !== 'https:' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || url.username || url.password) return undefined
    return `https://${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}`
  } catch {
    return undefined
  }
}
