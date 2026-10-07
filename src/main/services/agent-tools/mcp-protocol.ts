/**
 * Minimal, dependency-free MCP server core (JSON-RPC 2.0) for the Streamable
 * HTTP transport in stateless mode: every POST carries one message or a batch
 * and gets a JSON reply. Only what agents need: initialize, ping, tools.
 */

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolResult {
  text: string
  isError?: boolean
  /** Sent as an MCP image content block after the text (e.g. browser screenshots). */
  image?: { data: string; mimeType: string }
}

export interface ToolHost {
  /** Tools as seen by this caller (enum values reflect the live state, e.g. installed CLIs). */
  list(): ToolDefinition[]
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

export const SERVER_INSTRUCTIONS = [
  'You are one of several coding agents running side by side in Hiveory.',
  'These tools let you see and coordinate the other agents in this workspace:',
  'call list_agents first to learn their names and live status (idle / working / waiting-for-you);',
  'read_agent shows what an agent currently displays; send_message types a message into it;',
  'wait_for_agent blocks until it finishes; open_agent / close_agent / arrange_panes change the worktree;',
  'run_in_terminal runs a shell command in this worktree terminal and returns its output.',
  "browser_* tools drive Hiveory's built-in browser (it works even when the user's browser panel is closed):",
  'browser_navigate or browser_snapshot returns the page as compact text whose interactive elements carry refs like [@12];',
  'pass a ref as `target` to browser_click / browser_fill / browser_drag; every action returns a fresh snapshot, so do not snapshot again;',
  'use browser_batch to run several steps in one call — it is much faster than one tool call per step.',
  'Always refer to agents by the exact name list_agents returns.'
].join(' ')

const ok = (id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: id ?? null, result })
const err = (id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message }
})

const isRequest = (value: unknown): value is JsonRpcRequest =>
  typeof value === 'object' && value !== null && (value as JsonRpcRequest).jsonrpc === '2.0' && typeof (value as JsonRpcRequest).method === 'string'

/** Handles one JSON-RPC message. Returns null for notifications (no reply). */
export const handleMessage = async (message: unknown, host: ToolHost): Promise<JsonRpcResponse | null> => {
  if (!isRequest(message)) return err(null, -32600, 'Invalid Request')
  const { id, method, params } = message
  const isNotification = id === undefined
  try {
    switch (method) {
      case 'initialize': {
        const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : ''
        return ok(id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'hiveory', version: '1.0.0' },
          instructions: SERVER_INSTRUCTIONS
        })
      }
      case 'ping':
        return ok(id, {})
      case 'tools/list':
        return ok(id, { tools: host.list() })
      case 'tools/call': {
        const name = typeof params?.name === 'string' ? params.name : ''
        const args = typeof params?.arguments === 'object' && params.arguments !== null ? (params.arguments as Record<string, unknown>) : {}
        if (!host.list().some((t) => t.name === name)) return err(id, -32602, `Unknown tool: ${name}`)
        const result = await host.call(name, args)
        const content: unknown[] = [{ type: 'text', text: result.text }]
        if (result.image) content.push({ type: 'image', data: result.image.data, mimeType: result.image.mimeType })
        return ok(id, { content, isError: Boolean(result.isError) })
      }
      default:
        if (method.startsWith('notifications/') || isNotification) return null
        return err(id, -32601, `Method not found: ${method}`)
    }
  } catch (error) {
    // Tool failures are reported as tool results so the agent can read and recover.
    if (method === 'tools/call') {
      return ok(id, { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true })
    }
    return err(id, -32603, error instanceof Error ? error.message : 'Internal error')
  }
}

/** Handles a POST body: a single message or a batch. Returns null when nothing needs a reply. */
export const handleBody = async (body: unknown, host: ToolHost): Promise<unknown> => {
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleMessage(m, host)))).filter(Boolean)
    return replies.length ? replies : null
  }
  return handleMessage(body, host)
}
