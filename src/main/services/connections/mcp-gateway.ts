import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { homedir } from 'node:os'
import type { Logger } from '../../app/logger'
import type { ToolFamily } from '../agent-tools/agent-tools'
import type { ToolDefinition, ToolResult } from '../agent-tools/mcp-protocol'
import type { StoredConnection } from '../persistence/schema'

/** What Hiveory needs to start one MCP server, secrets included (main only). */
export interface ConnectionSpec {
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  /** Secret values of this connection: scrubbed from anything shown to agents or the user. */
  secrets?: string[]
}

/**
 * The environment a local MCP server starts with: only what a runtime needs to find
 * itself and the network (the SDK's safe list, plus locale, proxy and CA settings),
 * then the connection's own values. Never Hiveory's whole environment, which may
 * hold the user's other keys.
 */
const PASS_THROUGH = [
  'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE',
  'COMSPEC', 'PATHEXT', 'WINDIR', 'ProgramData', 'ProgramFiles(x86)', 'CommonProgramFiles', 'NUMBER_OF_PROCESSORS'
]
export const serverEnv = (own: Record<string, string> = {}): Record<string, string> => {
  const base = getDefaultEnvironment()
  for (const key of PASS_THROUGH) {
    const value = process.env[key]
    if (typeof value === 'string') base[key] = value
  }
  return { ...base, ...own }
}

/** Replaces each secret (6+ characters) with a mask. */
export const scrubSecrets = (text: string, secrets: readonly string[] = []): string =>
  secrets.filter((s) => s.length >= 6).reduce((out, s) => out.split(s).join('••••'), text)

export type CachedTool = StoredConnection['tools'][number]

interface Live {
  client: Client
  lastUsed: number
}

/** Unused servers stop after this long; the next call starts them again. */
const IDLE_MS = 10 * 60 * 1000
/** First run of `npx -y` / `uvx` downloads the package. */
const CONNECT_TIMEOUT_MS = 120_000
const CALL_TIMEOUT_MS = 10 * 60 * 1000
const MAX_NAME = 64

/** "Jira & Confluence" → "jira_confluence": the prefix of a connection's tools. */
export const toolPrefix = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'app'

/** Flattens an MCP tool result into Hiveory's ToolResult (text, plus the first image). */
export const toToolResult = (result: Record<string, unknown>): ToolResult => {
  const parts: string[] = []
  let image: ToolResult['image']
  for (const item of Array.isArray(result.content) ? (result.content as Array<Record<string, unknown>>) : []) {
    if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
    else if (item.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string') image ??= { data: item.data, mimeType: item.mimeType }
    else if (item.type === 'resource') {
      const r = (item.resource ?? {}) as Record<string, unknown>
      parts.push(typeof r.text === 'string' ? r.text : `[resource ${String(r.uri ?? '')}]`)
    } else if (item.type === 'resource_link') parts.push(`[${String(item.name ?? 'link')}] ${String(item.uri ?? '')}`)
  }
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2))
  return { text: parts.join('\n') || '(no output)', isError: Boolean(result.isError), ...(image ? { image } : {}) }
}

/**
 * Serves every enabled connection's tools through Hiveory's own MCP server,
 * so each agent gets them without any CLI config (ADR 0017). Servers start
 * on the first call, are shared by all agents, and stop when idle; the tool
 * list is cached, so listing tools never starts anything.
 */
export class McpGateway implements ToolFamily {
  private readonly live = new Map<string, Promise<Live>>()
  private readonly connecting = new Set<string>()
  private sweep: NodeJS.Timeout | null = null

  constructor(
    private readonly enabled: () => StoredConnection[],
    private readonly specOf: (connection: StoredConnection) => ConnectionSpec,
    private readonly log: Logger,
    private readonly version: string
  ) {}

  /** Exposed tool name → connection and its own tool name. */
  private table(): Map<string, { connection: StoredConnection; tool: CachedTool; name: string }> {
    const table = new Map<string, { connection: StoredConnection; tool: CachedTool; name: string }>()
    const prefixes = new Map<string, number>()
    for (const connection of this.enabled()) {
      let prefix = toolPrefix(connection.name)
      const seen = prefixes.get(prefix) ?? 0
      prefixes.set(prefix, seen + 1)
      if (seen) prefix = `${prefix}${seen + 1}`
      for (const tool of connection.tools) {
        const name = `${prefix}_${tool.name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, MAX_NAME)
        if (!table.has(name)) table.set(name, { connection, tool, name })
      }
    }
    return table
  }

  /** Tool names per connection id, as agents see them. */
  exposedNames(): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const { connection, name } of this.table().values()) out.set(connection.id, [...(out.get(connection.id) ?? []), name])
    return out
  }

  isConnecting(id: string): boolean {
    return this.connecting.has(id)
  }

  handles(name: string): boolean {
    return this.table().has(name)
  }

  definitions(): ToolDefinition[] {
    return [...this.table().values()].map(({ connection, tool, name }) => ({
      name,
      description: `[${connection.name}] ${tool.description}`.slice(0, 2000),
      inputSchema: tool.inputSchema
    }))
  }

  async call(_caller: unknown, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const entry = this.table().get(name)
    if (!entry) return { text: `Unknown tool: ${name}`, isError: true }
    try {
      const live = await this.open(entry.connection)
      live.lastUsed = Date.now()
      const result = await live.client.callTool({ name: entry.tool.name, arguments: args }, undefined, {
        timeout: CALL_TIMEOUT_MS,
        resetTimeoutOnProgress: true
      })
      live.lastUsed = Date.now()
      const out = toToolResult(result as Record<string, unknown>)
      return { ...out, text: scrubSecrets(out.text, this.secretsOf.get(entry.connection.id)) }
    } catch (error) {
      return { text: `${entry.connection.name}: ${this.describe(error, entry.connection.id)}`, isError: true }
    }
  }

  /** Starts (or restarts) a server and reads its tools. */
  async refresh(connection: StoredConnection): Promise<{ tools: CachedTool[] } | { error: string }> {
    await this.close(connection.id)
    this.connecting.add(connection.id)
    try {
      const live = await this.open(connection)
      const tools: CachedTool[] = []
      let cursor: string | undefined
      do {
        const page = await live.client.listTools(cursor ? { cursor } : undefined, { timeout: CONNECT_TIMEOUT_MS })
        for (const tool of page.tools) {
          tools.push({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema as Record<string, unknown> })
        }
        cursor = page.nextCursor
      } while (cursor && tools.length < 1000)
      return { tools }
    } catch (error) {
      const message = this.describe(error, connection.id)
      await this.close(connection.id)
      return { error: message }
    } finally {
      this.connecting.delete(connection.id)
    }
  }

  async close(id: string): Promise<void> {
    const live = this.live.get(id)
    this.live.delete(id)
    if (!live) return
    await live.then((l) => l.client.close()).catch(() => undefined)
  }

  async closeAll(): Promise<void> {
    if (this.sweep) clearInterval(this.sweep)
    this.sweep = null
    await Promise.all([...this.live.keys()].map((id) => this.close(id)))
  }

  private describe(error: unknown, id: string): string {
    const message = error instanceof Error ? error.message : String(error)
    const stderr = this.stderrOf.get(id)?.trim().split(/\r?\n/).slice(-3).join(' · ')
    // Errors reach agents and the UI: the stderr tail helps, the connection's secrets must not ride along.
    return scrubSecrets(stderr && !message.includes(stderr) ? `${message} (${stderr.slice(0, 400)})` : message, this.secretsOf.get(id))
  }

  private readonly stderrOf = new Map<string, string>()
  private readonly secretsOf = new Map<string, string[]>()

  private open(connection: StoredConnection): Promise<Live> {
    const existing = this.live.get(connection.id)
    if (existing) return existing
    const started = this.start(connection)
    this.live.set(connection.id, started)
    started.catch(() => this.live.get(connection.id) === started && this.live.delete(connection.id))
    this.sweep ??= setInterval(() => this.sweepIdle(), 60_000)
    this.sweep.unref?.()
    return started
  }

  private async start(connection: StoredConnection): Promise<Live> {
    const spec = this.specOf(connection)
    this.secretsOf.set(connection.id, [...(spec.secrets ?? []), ...Object.values(spec.env ?? {}), ...Object.values(spec.headers ?? {})])
    const client = new Client({ name: 'hiveory', version: this.version }, { capabilities: {} })
    const live: Live = { client, lastUsed: Date.now() }
    this.stderrOf.set(connection.id, '')
    client.onclose = () => {
      if (this.live.get(connection.id)) this.live.delete(connection.id)
    }
    if (spec.transport === 'stdio') {
      if (!spec.command) throw new Error('No command to run.')
      const transport = new StdioClientTransport({ command: spec.command, args: spec.args ?? [], env: serverEnv(spec.env), cwd: homedir(), stderr: 'pipe' })
      transport.stderr?.on('data', (chunk: Buffer) => this.stderrOf.set(connection.id, ((this.stderrOf.get(connection.id) ?? '') + chunk.toString()).slice(-4000)))
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS })
      return live
    }
    if (!spec.url) throw new Error('No server URL.')
    const url = new URL(spec.url)
    const requestInit = { headers: spec.headers ?? {} }
    try {
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit }), { timeout: CONNECT_TIMEOUT_MS })
    } catch (error) {
      // Older servers only speak the SSE transport.
      if (!/\b(404|405)\b/.test(String(error))) throw error
      this.log.info(`MCP ${connection.name}: falling back to SSE`)
      await client.connect(new SSEClientTransport(url, { requestInit, eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as Record<string, string>), ...requestInit.headers } }) } }), {
        timeout: CONNECT_TIMEOUT_MS
      })
    }
    return live
  }

  private sweepIdle(): void {
    const now = Date.now()
    for (const [id, promise] of this.live) {
      void promise
        .then((l) => {
          if (now - l.lastUsed > IDLE_MS) void this.close(id)
        })
        .catch(() => undefined)
    }
    if (!this.live.size && this.sweep) {
      clearInterval(this.sweep)
      this.sweep = null
    }
  }
}
