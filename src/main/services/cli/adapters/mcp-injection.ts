import type { McpEndpoint } from './types'

/**
 * How Hiveory's agent-tools MCP server is described to each CLI. Every CLI
 * gets the same loopback Streamable-HTTP endpoint with a bearer token; only
 * the config syntax differs.
 */

export const MCP_SERVER_NAME = 'hiveory'

/** wait_for_agent may legitimately block for up to 15 minutes. */
export const MCP_TOOL_TIMEOUT_MS = 16 * 60 * 1000

/** One-line orientation so an agent understands the tools immediately. */
export const AGENT_TOOLS_PROMPT =
  'You are running inside Hiveory next to other coding agents. Use the hiveory MCP tools to coordinate: ' +
  'list_agents (names + live status), read_agent, send_message, wait_for_agent, open_agent, close_agent, ' +
  'arrange_panes and run_in_terminal. Always use the exact agent names list_agents returns.'

/** `{ mcpServers: { hiveory: … } }` — the shape Claude Code and Copilot CLI accept. */
export const mcpServersJson = (mcp: McpEndpoint, extra: Record<string, unknown> = {}) => ({
  mcpServers: {
    [MCP_SERVER_NAME]: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` }, ...extra }
  }
})

/** OpenCode / Kilo inline config (OPENCODE_CONFIG_CONTENT / KILO_CONFIG_CONTENT). */
export const opencodeConfigJson = (mcp: McpEndpoint): string =>
  JSON.stringify({
    mcp: {
      [MCP_SERVER_NAME]: {
        type: 'remote',
        url: mcp.url,
        headers: { Authorization: `Bearer ${mcp.token}` },
        enabled: true,
        timeout: MCP_TOOL_TIMEOUT_MS
      }
    }
  })

/** Codex `-c` overrides; the token travels in an env var, never on the command line. */
export const codexMcpArgs = (mcp: McpEndpoint): string[] => [
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.url=${JSON.stringify(mcp.url)}`,
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.bearer_token_env_var="HIVEORY_MCP_TOKEN"`,
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.tool_timeout_sec=${Math.round(MCP_TOOL_TIMEOUT_MS / 1000)}`
]
