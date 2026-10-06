import { pluginAppById, type ConnectionView, type PluginConnectResult } from '@shared/domain'
import { fail } from '@shared/errors'
import type { ConnectionService } from './connection-service'
import type { McpGateway } from './mcp-gateway'
import { isSafeLink } from './oauth'

/** Composio's tool that checks an app's connection and returns a link to approve a missing one. */
const MANAGE = 'COMPOSIO_MANAGE_CONNECTIONS'

/** The first http(s) URL under a key that names a link or URL, at any depth. */
const findLink = (value: unknown, depth = 0): string | undefined => {
  if (!value || typeof value !== 'object' || depth > 4) return undefined
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && /url|link/i.test(key) && /^https?:\/\//.test(item)) return item
    const nested = findLink(item, depth + 1)
    if (nested) return nested
  }
  return undefined
}

/** What Composio said about one app: connected, a link for the user to approve it, or why neither. */
export const readConnection = (text: string, appId: string): { connected: boolean; link?: string; error?: string } => {
  let root: Record<string, unknown>
  try {
    root = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>
  } catch {
    return { connected: false, error: text.slice(0, 300) || 'Composio gave no answer.' }
  }
  const data = (root.data ?? root) as Record<string, unknown>
  const results = (data.results ?? {}) as Record<string, unknown>
  const entry = (results[appId] ?? Object.values(results)[0] ?? {}) as Record<string, unknown>
  const status = String(entry.status ?? entry.connection_status ?? '')
  if (/^(active|connected)$/i.test(status) || entry.has_active_connection === true) return { connected: true }
  const link = findLink(entry)
  if (link) return { connected: false, link }
  return { connected: false, error: String(entry.error ?? entry.message ?? root.error ?? data.message ?? 'Composio did not return a link to connect it.') }
}

/**
 * Plugins (ADR 0023): the user signs in to their own Composio account once,
 * then connects each app on Composio's own page. Hiveory asks Composio through
 * its MCP tools, so it needs no Composio API key and keeps no app keys.
 */
export class PluginService {
  constructor(
    private readonly connections: ConnectionService,
    private readonly gateway: McpGateway,
    private readonly openBrowser: (url: string) => void
  ) {}

  signIn(): Promise<ConnectionView> {
    return this.connections.signInComposio()
  }

  async signOut(): Promise<void> {
    const account = this.connections.composio()
    if (account) await this.connections.remove(account.id)
  }

  /** Connects an app: done straight away when Composio already has it, else its approval page opens. */
  connect(appId: string): Promise<PluginConnectResult> {
    return this.manage(appId, true)
  }

  /** Asks Composio again, after the user came back from the approval page. */
  check(appId: string): Promise<PluginConnectResult> {
    return this.manage(appId, false)
  }

  private async manage(appId: string, openLink: boolean): Promise<PluginConnectResult> {
    if (!pluginAppById(appId)) fail('NOT_FOUND', 'Unknown app.')
    const account = this.connections.composio()
    if (!account?.enabled || !account.tools.length) fail('INVALID_INPUT', 'Sign in to Composio first.')
    const result = await this.gateway.invoke(account!, MANAGE, { toolkits: [appId] })
    if (result.isError) fail('UNEXPECTED', result.text)
    const answer = readConnection(result.text, appId)
    const apps = new Set(this.connections.composio()?.apps ?? [])
    if (answer.connected) {
      apps.add(appId)
      this.connections.setApps(account!.id, [...apps])
      return { state: 'connected' }
    }
    if (!answer.link) fail('UNEXPECTED', answer.error ?? 'Composio could not connect it.')
    if (openLink) {
      if (!isSafeLink(answer.link!)) fail('FORBIDDEN', 'Composio returned an insecure link.')
      this.openBrowser(answer.link!)
    }
    // Not active (any more): agents are no longer told it is connected.
    if (apps.delete(appId)) this.connections.setApps(account!.id, [...apps])
    return { state: 'pending' }
  }
}
