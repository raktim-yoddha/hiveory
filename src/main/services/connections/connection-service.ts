import { randomBytes } from 'node:crypto'
import { pluginById, resolvePluginServer, type ConnectionView } from '@shared/domain'
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
 * The MCP servers and plugins Hiveory runs for every agent (ADR 0017):
 * plugins set up with the user's keys, servers added by hand and servers
 * imported from a CLI's config. Keys are sealed at rest and never leave main.
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

  /** Names of enabled apps agents can use, for the agent prompt; a hub says what it holds. */
  appNames(): string[] {
    return this.enabled()
      .filter((c) => c.tools.length)
      .map((c) => {
        const hint = c.pluginId ? pluginById(c.pluginId)?.agentHint : undefined
        return hint ? `${c.name} (${hint})` : c.name
      })
  }

  /** The server to start, with secrets opened. */
  spec(connection: StoredConnection): ConnectionSpec {
    const open = (record: Record<string, string>): Record<string, string> =>
      Object.fromEntries(Object.entries(record).map(([k, v]) => [k, this.box.open(v)]))
    if (connection.pluginId) {
      const plugin = pluginById(connection.pluginId)
      if (!plugin) fail('NOT_FOUND', `Unknown plugin: ${connection.pluginId}`)
      const opened = open(connection.values)
      const { server } = resolvePluginServer(plugin!, opened)
      // Automated runs point a sign-in plugin at a local stand-in (like HIVEORY_USER_DATA).
      const standIn = plugin!.auth === 'oauth' ? process.env[`HIVEORY_PLUGIN_URL_${plugin!.id.toUpperCase()}`] : undefined
      if (standIn && server.transport === 'http') server.url = standIn
      const secrets = plugin!.fields.filter((f) => f.secret && opened[f.key]).map((f) => opened[f.key]!)
      return { ...server, secrets, ...(plugin!.auth === 'oauth' ? { oauth: this.oauth(connection.id, plugin!.name) } : {}) }
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
    const plugin = connection.pluginId ? pluginById(connection.pluginId) : undefined
    const secretKeys = new Set(plugin?.fields.filter((f) => f.secret).map((f) => f.key))
    const values = Object.fromEntries(Object.entries(connection.values).filter(([k]) => !secretKeys.has(k)).map(([k, v]) => [k, this.box.open(v)]))
    const names = this.gateway?.exposedNames().get(connection.id)
    const spec = this.spec(connection)
    return {
      id: connection.id,
      name: connection.name,
      ...(connection.pluginId ? { pluginId: connection.pluginId } : {}),
      ...(connection.label ? { label: connection.label } : {}),
      enabled: connection.enabled,
      transport: spec.transport,
      target: spec.transport === 'http' ? redactUrl(spec.url ?? '') : [spec.command ?? '', ...(spec.args ?? [])].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
      values,
      secretsSet: [...Object.keys(connection.values).filter((k) => secretKeys.has(k)), ...Object.keys(connection.env), ...Object.keys(connection.headers)],
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

  /**
   * Sets up a plugin account from the catalog and connects to it. `id` edits that
   * account; without it a new account is added, so one plugin can hold several
   * (work and personal GitHub…). Each account gets its own name — "GitHub · Work" —
   * and so its own tool prefix, so agents always know which account they use.
   */
  async savePlugin(pluginId: string, values: Record<string, string>, options: { id?: string; label?: string } = {}): Promise<ConnectionView> {
    const plugin = pluginById(pluginId)
    if (!plugin) fail('NOT_FOUND', `Unknown plugin: ${pluginId}`)
    const existing = options.id ? this.find(options.id) : undefined
    if (existing && existing.pluginId !== pluginId) fail('INVALID_INPUT', 'That connection belongs to another plugin.')
    const label = (options.label ?? existing?.label ?? '').trim()
    const name = label ? `${plugin!.name} · ${label}` : plugin!.name
    const clash = this.all().find((c) => c.id !== existing?.id && c.name.toLowerCase() === name.toLowerCase())
    if (clash) fail('INVALID_INPUT', label ? `${name} already exists. Pick another account name.` : `${plugin!.name} is already set up. Name this account (for example Work) to add another.`)
    const stored = existing?.values ?? {}
    const next: Record<string, string> = {}
    for (const field of plugin!.fields) {
      const value = (values[field.key] ?? '').trim()
      if (field.secret) {
        if (value) next[field.key] = this.box.seal(value)
        else if (stored[field.key]) next[field.key] = stored[field.key]!
      } else if (value) next[field.key] = value
    }
    const opened = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, this.box.open(v)]))
    const { missing } = resolvePluginServer(plugin!, opened)
    if (missing.length) fail('INVALID_INPUT', `Fill in: ${missing.join(', ')}.`)
    const connection: StoredConnection = {
      ...(existing ?? { id: newId(), env: {}, headers: {}, tools: [] }),
      name,
      pluginId,
      ...(label ? { label } : {}),
      enabled: true,
      transport: plugin!.server.transport,
      values: next
    }
    if (!label) delete connection.label
    this.put(connection)
    return this.test(connection.id)
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
      values: {},
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
      values: {},
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
