import { COMPOSIO, pluginAppById, type PluginAccount, type PluginStatus } from '@shared/domain'
import { fail } from '@shared/errors'
import { COMPOSIO_KEY_HEADER, type ConnectionService } from './connection-service'

/**
 * Composio's user id for this Hiveory. The project is the user's own, so one id
 * is enough — and the same id on each of their computers shares their accounts.
 */
export const COMPOSIO_USER = 'hiveory'

const STATUS: Record<string, PluginAccount['status']> = {
  ACTIVE: 'active',
  INITIATED: 'pending',
  INITIALIZING: 'pending',
  FAILED: 'failed',
  EXPIRED: 'expired'
}

/** https, or http only for a server on this computer (a local stand-in, as in the e2e run). */
const isSafeLink = (link: string): boolean => {
  try {
    const url = new URL(link)
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  } catch {
    return false
  }
}

/** Composio's error text ({ error: { message } }), or the raw body. */
const errorText = (body: string): string => {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    return (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ?? parsed.message ?? body
  } catch {
    return body
  }
}

interface ComposioAccount {
  id: string
  toolkit: { slug: string }
  alias?: string | null
  status: string
}

/**
 * Plugins (ADR 0023): the user pastes their Composio project API key once.
 * Connect then asks Composio for the app's own sign-in link — no Composio login —
 * and an app can hold several accounts, each with a label. Agents get the
 * connected apps through a Composio tool-router session served by the gateway.
 * Only ids, apps, labels and statuses ever leave main; Composio's account state
 * (which can hold credentials) is never passed on.
 */
export class PluginService {
  constructor(
    private readonly connections: ConnectionService,
    private readonly openBrowser: (url: string) => void,
    private readonly fetchFn: typeof fetch = fetch,
    // Automated runs point this at a local stand-in (like HIVEORY_USER_DATA).
    private readonly apiUrl: string = process.env.HIVEORY_COMPOSIO_API || COMPOSIO.apiUrl
  ) {}

  /** Calls Composio's REST API; null for a 404 when `missingOk`. */
  private async request<T>(path: string, options: { method?: string; body?: unknown; key?: string; missingOk?: boolean } = {}): Promise<T | null> {
    const key = options.key ?? this.connections.composioKey()
    if (!key) fail('INVALID_INPUT', 'Add your Composio API key first.')
    let res: Response
    try {
      res = await this.fetchFn(`${this.apiUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: { [COMPOSIO_KEY_HEADER]: key!, 'content-type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(30_000)
      })
    } catch (error) {
      return fail('UNEXPECTED', `Composio could not be reached: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (res.status === 401 || res.status === 403) fail('FORBIDDEN', 'Composio did not accept this API key. Copy a project API key from platform.composio.dev.')
    if (res.status === 404 && options.missingOk) return null
    const text = await res.text()
    if (!res.ok) fail('UNEXPECTED', `Composio: ${errorText(text).slice(0, 300) || res.status}`)
    return (text ? JSON.parse(text) : {}) as T
  }

  /** A tool-router session for this user: one MCP server with every connected app, several accounts each. */
  private async newSession(key: string): Promise<{ session: string; url: string }> {
    const created = await this.request<{ session_id: string; mcp: { url: string } }>('/tool_router/session', {
      method: 'POST',
      key,
      body: { user_id: COMPOSIO_USER, manage_connections: { enable: true }, multi_account: { enable: true } }
    })
    if (!created?.session_id || !created.mcp?.url) fail('UNEXPECTED', 'Composio did not start a session.')
    return { session: created!.session_id, url: created!.mcp.url }
  }

  /** Saves the key once it works (starting the session proves it), then connects agents to Composio. */
  async setKey(apiKey: string): Promise<PluginStatus> {
    const session = await this.newSession(apiKey)
    await this.connections.saveComposio({ apiKey, ...session })
    return this.status()
  }

  async removeKey(): Promise<void> {
    const connection = this.connections.composio()
    if (connection) await this.connections.remove(connection.id)
  }

  async status(): Promise<PluginStatus> {
    if (!this.connections.composioKey()) return { keySet: false, accounts: [] }
    try {
      return { keySet: true, accounts: await this.accounts() }
    } catch (error) {
      return { keySet: true, accounts: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** The user's accounts in Composio; the active apps are kept for the agent prompt. */
  private async accounts(): Promise<PluginAccount[]> {
    const listed = await this.request<{ items?: ComposioAccount[] }>(`/connected_accounts?user_ids=${COMPOSIO_USER}&limit=200`)
    const accounts = (listed?.items ?? []).flatMap((item): PluginAccount[] => {
      const status = STATUS[item.status]
      return status && item.toolkit?.slug ? [{ id: item.id, appId: item.toolkit.slug, ...(item.alias ? { label: item.alias } : {}), status }] : []
    })
    const connection = this.connections.composio()
    const apps = [...new Set(accounts.filter((a) => a.status === 'active').map((a) => a.appId))].sort()
    if (connection && apps.join() !== (connection.apps ?? []).join()) this.connections.setApps(connection.id, apps)
    return accounts
  }

  /** Opens the app's own sign-in page for a new account; `label` tells several accounts apart. */
  async connect(appId: string, label?: string): Promise<PluginAccount> {
    if (!pluginAppById(appId)) fail('NOT_FOUND', 'Unknown app.')
    const alias = label?.trim() || undefined
    const body = { toolkit: appId, ...(alias ? { alias } : {}) }
    const linkFor = (session: string) =>
      this.request<{ redirect_url: string; connected_account_id: string }>(`/tool_router/session/${encodeURIComponent(session)}/link`, { method: 'POST', body, missingOk: true })
    let link = await linkFor(this.connections.composio()?.session ?? '')
    if (!link) {
      // The session was deleted on Composio's side: start a new one and keep going.
      const key = this.connections.composioKey()!
      const session = await this.newSession(key)
      await this.connections.saveComposio({ apiKey: key, ...session })
      link = await linkFor(session.session)
    }
    if (!link?.redirect_url || !isSafeLink(link.redirect_url)) fail('UNEXPECTED', 'Composio did not return a secure sign-in link.')
    this.openBrowser(link!.redirect_url)
    return { id: link!.connected_account_id, appId, ...(alias ? { label: alias } : {}), status: 'pending' }
  }

  /** Removes one of the user's accounts from Composio. */
  async disconnect(accountId: string): Promise<void> {
    if (!(await this.accounts()).some((a) => a.id === accountId)) fail('NOT_FOUND', 'That account is no longer connected.')
    await this.request(`/connected_accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' })
    await this.accounts()
  }
}
