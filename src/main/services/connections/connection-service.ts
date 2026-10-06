import { randomBytes } from 'node:crypto'
import { COMPOSIO, pluginAppById, type ConnectionView } from '@shared/domain'
import { fail } from '@shared/errors'
import type { Emit } from '../events'
import type { McpRawConfig } from '../extensions/extensions-service'
import type { StateStore } from '../persistence/state-store'
import type { StoredConnection } from '../persistence/schema'
import type { ConnectionSpec, McpGateway } from './mcp-gateway'
import { ConnectionOAuth, type OAuthState } from './oauth'
import type { SecretBox } from './secret-box'

export interface CustomInput {
  id?: string
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  /** An empty value keeps the stored one. */
  env: Record<string, string>
  headers: Record<string, string>
}

const newId = (): string => `c${randomBytes(6).toString('hex')}`
const isHttpUrl = (url: string): boolean => /^https?:\/\/\S+$/i.test(url)

/** Seals the new values over the stored ones; '' keeps an existing value, a missing key drops it. */
const mergeSealed = (stored: Record<string, string>, next: Record<string, string>, box: SecretBox): Record<string, string> =>
  Object.fromEntries(
    Object.entries(next).flatMap(([key, value]) => (value ? [[key, box.seal(value)]] : stored[key] ? [[key, stored[key]]] : []))
  )

/**
 * The MCP servers Hiveory runs for every agent (ADR 0017): the user's Composio
 * account, which serves the plugins (ADR 0023), servers added by hand and
 * servers imported from a CLI's config. Secrets are sealed and never leave main.
 */
export class ConnectionService {
  constructor(
    private readonly store: StateStore,
    private readonly box: SecretBox,
    private readonly broadcast: Emit,
    /** Opens a provider's sign-in page in the user's browser. */
    private readonly openBrowser: (url: string) => void = () => undefined,
    private gateway: McpGateway | null = null
  ) {}

  /** The gateway needs the service's specs, so it is attached after both exist. */
  attach(gateway: McpGateway): void {
    this.gateway = gateway
  }

  all(): StoredConnection[] {
    return this.store.state.connections
  }

  enabled(): StoredConnection[] {
    return this.all().filter((c) => c.enabled)
  }

  /** Names of enabled apps agents can use, for the agent prompt; Composio says which apps it holds. */
  appNames(): string[] {
    return this.enabled()
      .filter((c) => c.tools.length)
      .map((c) => {
        if (c.pluginId !== COMPOSIO.id) return c.name
        const apps = (c.apps ?? []).map((id) => pluginAppById(id)?.name ?? id)
        return `${c.name} (${apps.length ? `connected: ${apps.join(', ')}; ` : ''}${COMPOSIO.agentHint})`
      })
  }

  /** The user's Composio account, when they signed in. */
  composio(): StoredConnection | undefined {
    return this.all().find((c) => c.pluginId === COMPOSIO.id)
  }

  /** The server to start, with secrets opened. */
  spec(connection: StoredConnection): ConnectionSpec {
    const open = (record: Record<string, string>): Record<string, string> =>
      Object.fromEntries(Object.entries(record).map(([k, v]) => [k, this.box.open(v)]))
    if (connection.pluginId === COMPOSIO.id) {
      // Automated runs point it at a local stand-in (like HIVEORY_USER_DATA).
      return { transport: 'http', url: process.env.HIVEORY_PLUGIN_URL_COMPOSIO || COMPOSIO.mcpUrl, headers: {}, oauth: this.oauth(connection.id, COMPOSIO.name) }
    }
    return { transport: connection.transport, command: connection.command, args: connection.args, url: connection.url, env: open(connection.env), headers: open(connection.headers) }
  }

  /** The sign-in of an OAuth plugin, read fresh from the store and sealed back into it. */
  private oauth(id: string, name: string): ConnectionOAuth {
    const sealed = this.all().find((c) => c.id === id)?.oauth
    let state: OAuthState = {}
    try {
      state = sealed ? (JSON.parse(this.box.open(sealed)) as OAuthState) : {}
    } catch {
      // Sealed on another machine: the user signs in again.
    }
    const persist = (next: OAuthState): void =>
      this.store.update((s) => {
        const target = s.connections.find((c) => c.id === id)
        if (!target) return
        if (next.client || next.tokens) target.oauth = this.box.seal(JSON.stringify(next))
        else delete target.oauth
      })
    return new ConnectionOAuth(state, persist, this.openBrowser, name)
  }

  view(connection: StoredConnection): ConnectionView {
    const names = this.gateway?.exposedNames().get(connection.id)
    const spec = this.spec(connection)
    return {
      id: connection.id,
      name: connection.name,
      ...(connection.pluginId ? { pluginId: connection.pluginId, apps: connection.apps ?? [] } : {}),
      enabled: connection.enabled,
      transport: spec.transport,
      target: spec.transport === 'http' ? redactUrl(spec.url ?? '') : [spec.command ?? '', ...(spec.args ?? [])].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
      secretsSet: [...Object.keys(connection.env), ...Object.keys(connection.headers)],
      envKeys: Object.keys(connection.env),
      headerKeys: Object.keys(connection.headers),
      tools: connection.tools.map((t, i) => ({ name: names?.[i] ?? t.name, description: t.description || undefined })),
      state: this.gateway?.isConnecting(connection.id) ? 'connecting' : connection.error ? 'error' : connection.tools.length ? 'ready' : 'untested',
      ...(connection.error ? { error: connection.error } : {}),
      ...(connection.importedFrom ? { importedFrom: connection.importedFrom } : {})
    }
  }

  list(): ConnectionView[] {
    return this.all().map((c) => this.view(c))
  }

  private find(id: string): StoredConnection {
    const connection = this.all().find((c) => c.id === id)
    if (!connection) fail('NOT_FOUND', 'That connection no longer exists.')
    return connection!
  }

  private put(connection: StoredConnection): void {
    this.store.update((s) => {
      const index = s.connections.findIndex((c) => c.id === connection.id)
      if (index < 0) s.connections.push(connection)
      else s.connections[index] = connection
    })
    this.broadcast('state.changed', { topic: 'connections' })
  }

  /** Signs in to the user's Composio account (the browser opens when needed) and reads its tools. */
  async signInComposio(): Promise<ConnectionView> {
    const existing = this.composio()
    const connection: StoredConnection = existing
      ? { ...existing, enabled: true }
      : { id: newId(), name: COMPOSIO.name, pluginId: COMPOSIO.id, apps: [], enabled: true, transport: 'http', env: {}, headers: {}, tools: [] }
    this.put(connection)
    return this.test(connection.id)
  }

  /** Records which Composio apps are connected, for the Plugins screen and the agent prompt. */
  setApps(id: string, apps: string[]): void {
    this.put({ ...this.find(id), apps: [...new Set(apps)].sort() })
  }

  /** Adds or edits a server entered by hand, then connects to it. */
  async saveCustom(input: CustomInput): Promise<ConnectionView> {
    const existing = input.id ? this.find(input.id) : undefined
    if (input.transport === 'stdio' && !input.command?.trim()) fail('INVALID_INPUT', 'Enter the command that starts the server.')
    if (input.transport === 'http' && !isHttpUrl(input.url?.trim() ?? '')) fail('INVALID_INPUT', 'Enter an http(s) URL for the server.')
    const clash = this.all().find((c) => c.id !== existing?.id && c.name.toLowerCase() === input.name.trim().toLowerCase())
    if (clash) fail('INVALID_INPUT', `"${clash.name}" already exists. Pick another name.`)
    const connection: StoredConnection = {
      id: existing?.id ?? newId(),
      name: input.name.trim(),
      enabled: existing?.enabled ?? true,
      transport: input.transport,
      ...(input.transport === 'stdio' ? { command: input.command!.trim(), args: input.args ?? [] } : { url: input.url!.trim() }),
      env: input.transport === 'stdio' ? mergeSealed(existing?.env ?? {}, input.env, this.box) : {},
      headers: input.transport === 'http' ? mergeSealed(existing?.headers ?? {}, input.headers, this.box) : {},
      tools: existing?.tools ?? [],
      ...(existing?.importedFrom ? { importedFrom: existing.importedFrom } : {})
    }
    this.put(connection)
    return this.test(connection.id)
  }

  /** Brings a server from a CLI's config into Hiveory so every agent gets it. */
  async importServer(name: string, raw: McpRawConfig, from: string): Promise<ConnectionView> {
    if (this.all().some((c) => c.name.toLowerCase() === name.toLowerCase())) fail('INVALID_INPUT', `"${name}" is already in Hiveory.`)
    const seal = (record: Record<string, string> = {}): Record<string, string> =>
      Object.fromEntries(Object.entries(record).map(([k, v]) => [k, this.box.seal(v)]))
    const connection: StoredConnection = {
      id: newId(),
      name: name.slice(0, 40),
      enabled: true,
      transport: raw.url ? 'http' : 'stdio',
      ...(raw.url ? { url: raw.url } : { command: raw.command, args: raw.args ?? [] }),
      env: seal(raw.env),
      headers: seal(raw.headers),
      tools: [],
      importedFrom: from
    }
    this.put(connection)
    return this.test(connection.id)
  }

  async setEnabled(id: string, enabled: boolean): Promise<ConnectionView> {
    const connection = { ...this.find(id), enabled }
    this.put(connection)
    if (!enabled) await this.gateway?.close(id)
    return enabled && !connection.tools.length ? this.test(id) : this.view(connection)
  }

  /** Connects, reads the tool list and stores it (or the error). */
  async test(id: string): Promise<ConnectionView> {
    if (!this.gateway) fail('UNEXPECTED', 'Connections are not ready yet.')
    const connection = this.find(id)
    this.broadcast('state.changed', { topic: 'connections' })
    const outcome = await this.gateway!.refresh(connection)
    const latest = this.all().find((c) => c.id === id)
    if (!latest) fail('NOT_FOUND', 'That connection was removed.')
    const next: StoredConnection =
      'tools' in outcome ? { ...latest!, tools: outcome.tools, error: undefined } : { ...latest!, error: outcome.error }
    if (!next.error) delete next.error
    this.put(next)
    return this.view(next)
  }

  async remove(id: string): Promise<void> {
    this.find(id)
    await this.gateway?.close(id)
    this.store.update((s) => {
      s.connections = s.connections.filter((c) => c.id !== id)
    })
    this.broadcast('state.changed', { topic: 'connections' })
  }
}

/** Origin and path only, long path segments masked: URLs such as Zapier's carry the key in them. */
export const redactUrl = (url: string): string => {
  try {
    const u = new URL(url)
    return u.origin + u.pathname.split('/').map((part) => (part.length > 24 ? '…' : part)).join('/')
  } catch {
    return '…'
  }
}
