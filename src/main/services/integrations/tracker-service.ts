import { fail } from '@shared/errors'
import { jiraSiteOf, type Issue, type IntegrationsView, type TrackerGroup, type TrackerId } from '@shared/domain/integrations'
import type { SecretBox } from '../connections/secret-box'
import type { StateStore } from '../persistence/state-store'

type Fetch = typeof fetch

const TIMEOUT_MS = 15_000
const LINEAR_API = 'https://api.linear.app/graphql'
/** Keys of Jira projects and Linear teams: letters, digits, underscore. */
const GROUP_KEY = /^[A-Za-z][A-Za-z0-9_]{0,19}$/

/**
 * Jira (Cloud) and Linear issues for a Workspace (ADR 0040). The user's key is sealed by SecretBox,
 * sent only to that service's own address, and never to the renderer, a model or the phone.
 */
export class TrackerService {
  constructor(
    private readonly store: StateStore,
    private readonly box: SecretBox,
    private readonly http: Fetch = fetch
  ) {}

  /** What Settings › Integrations shows: which trackers are connected, never their keys. */
  view(): Pick<IntegrationsView, 'jira' | 'linear'> {
    const t = this.store.state.trackers ?? {}
    return { ...(t.jira ? { jira: { site: t.jira.site, email: t.jira.email } } : {}), ...(t.linear ? { linear: { connected: true as const } } : {}) }
  }

  async connectJira(input: { site: string; email: string; token: string }): Promise<void> {
    const site = jiraSiteOf(input.site) ?? fail('INVALID_INPUT', 'That is not a Jira site address.', { hint: 'Like acme.atlassian.net.' })
    const jira = { site, email: input.email.trim(), token: input.token.trim() }
    await this.jira<{ accountId?: string }>(jira, '/rest/api/3/myself')
    this.store.update((s) => {
      s.trackers = { ...s.trackers, jira: { site, email: jira.email, token: this.box.seal(jira.token) } }
    })
  }

  async connectLinear(apiKey: string): Promise<void> {
    const key = apiKey.trim()
    await this.linear<{ viewer: { id: string } }>(key, '{ viewer { id } }')
    this.store.update((s) => {
      s.trackers = { ...s.trackers, linear: { key: this.box.seal(key) } }
    })
  }

  disconnect(tracker: TrackerId): void {
    this.store.update((s) => {
      const next = { ...s.trackers }
      delete next[tracker]
      s.trackers = next
    })
  }

  /** Jira projects or Linear teams, for a Workspace's issue source. */
  async groups(tracker: TrackerId): Promise<TrackerGroup[]> {
    if (tracker === 'jira') {
      const out = await this.jira<{ values?: Array<{ key: string; name: string }> }>(this.jiraCreds(), '/rest/api/3/project/search?maxResults=100&orderBy=name')
      return (out.values ?? []).map((p) => ({ key: p.key, name: p.name }))
    }
    const out = await this.linear<{ teams: { nodes: Array<{ key: string; name: string }> } }>(this.linearKey(), '{ teams(first: 100) { nodes { key name } } }')
    return out.teams.nodes.map((t) => ({ key: t.key, name: t.name }))
  }

  /** Open issues of a Jira project or Linear team, most recently updated first. */
  async issues(tracker: TrackerId, group: string): Promise<Issue[]> {
    if (!GROUP_KEY.test(group)) fail('INVALID_INPUT', `That is not a ${tracker === 'jira' ? 'Jira project' : 'Linear team'} key.`)
    if (tracker === 'jira') {
      const creds = this.jiraCreds()
      const jql = encodeURIComponent(`project = "${group}" AND statusCategory != Done ORDER BY updated DESC`)
      const out = await this.jira<{ issues?: Array<{ key: string; fields: { summary: string; status?: { name?: string } } }> }>(
        creds,
        `/rest/api/3/search/jql?jql=${jql}&fields=summary,status&maxResults=50`
      )
      return (out.issues ?? []).map((i) => ({ key: i.key, title: i.fields.summary, url: `${creds.site}/browse/${i.key}`, state: i.fields.status?.name }))
    }
    const out = await this.linear<{ issues: { nodes: Array<{ identifier: string; title: string; url: string; state?: { name?: string } }> } }>(
      this.linearKey(),
      `query($team: String!) { issues(first: 50, orderBy: updatedAt, filter: { team: { key: { eq: $team } }, state: { type: { nin: ["completed", "canceled"] } } }) { nodes { identifier title url state { name } } } }`,
      { team: group }
    )
    return out.issues.nodes.map((i) => ({ key: i.identifier, title: i.title, url: i.url, state: i.state?.name }))
  }

  private jiraCreds(): { site: string; email: string; token: string } {
    const jira = this.store.state.trackers?.jira ?? fail('INVALID_INPUT', 'Jira is not connected.', { hint: 'Connect it in Settings › Integrations.' })
    const token = this.box.open(jira.token) || fail('INVALID_INPUT', 'The saved Jira token cannot be read on this computer.', { hint: 'Connect Jira again in Settings › Integrations.' })
    return { site: jira.site, email: jira.email, token }
  }

  private linearKey(): string {
    const sealed = this.store.state.trackers?.linear?.key ?? fail('INVALID_INPUT', 'Linear is not connected.', { hint: 'Connect it in Settings › Integrations.' })
    return this.box.open(sealed) || fail('INVALID_INPUT', 'The saved Linear key cannot be read on this computer.', { hint: 'Connect Linear again in Settings › Integrations.' })
  }

  private async jira<T>(creds: { site: string; email: string; token: string }, path: string): Promise<T> {
    const auth = Buffer.from(`${creds.email}:${creds.token}`).toString('base64')
    return this.call<T>('Jira', `${creds.site}${path}`, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } })
  }

  private async linear<T>(key: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    const out = await this.call<{ data?: T; errors?: Array<{ message: string }> }>('Linear', LINEAR_API, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    })
    if (out.errors?.length || !out.data) fail('INVALID_INPUT', 'Linear reported an error.', { detail: out.errors?.map((e) => e.message).join('; ') })
    return out.data!
  }

  private async call<T>(service: string, url: string, init: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await this.http(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      return fail('INVALID_INPUT', `Could not reach ${service}.`, { hint: 'Check the address and your connection.' })
    }
    if (response.status === 401 || response.status === 403) fail('FORBIDDEN', `${service} did not accept these details.`, { hint: 'Check the email and key, then connect again.' })
    if (!response.ok) fail('INVALID_INPUT', `${service} answered ${response.status}.`)
    return (await response.json()) as T
  }
}
