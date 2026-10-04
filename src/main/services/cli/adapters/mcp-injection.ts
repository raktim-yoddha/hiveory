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

/**
 * Routes website work to Hiveory's browser. Without it, CLIs reach for their
 * own fetch tools (WebFetch, curl, web search) and the user sees nothing.
 */
export const BROWSER_PROMPT =
  "Hiveory gives you a real browser that the user watches live: the hiveory browser_* MCP tools. " +
  'Whenever a request involves a website or URL — open, check, visit, read, explore, scrape, test, log in, fill a form, ' +
  'screenshot — use these browser tools, NOT WebFetch, curl, wget, Invoke-WebRequest or web search for reading pages. ' +
  'Start with browser_navigate (it returns the page as text with element refs like [@12]); act with browser_click / ' +
  'browser_fill on refs; read a whole page with browser_snapshot full_page:true and visit its links to cover a whole site; ' +
  'run several steps in one call with browser_batch.'

/** The system-prompt addition for an agent Hiveory launches (chat-only runs have no coordination tools). */
export const agentPrompt = (mcp: McpEndpoint, coordination = true): string =>
  [coordination ? AGENT_TOOLS_PROMPT : '', mcp.browser ? BROWSER_PROMPT : ''].filter(Boolean).join(' ')

/** Claude Code flags that load Hiveory's MCP server from `configPath`, pre-approved, with the prompt. */
export const claudeMcpArgs = (mcp: McpEndpoint, configPath: string, coordination = true): string[] => [
  '--mcp-config',
  configPath,
  '--allowedTools',
  'mcp__hiveory',
  '--append-system-prompt',
  agentPrompt(mcp, coordination),
  // Its own page fetcher would bypass the browser the user is watching; web search stays available.
  ...(mcp.browser ? ['--disallowedTools', 'WebFetch'] : [])
]

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
export const codexMcpArgs = (mcp: McpEndpoint, coordination = true): string[] => [
  '-c',
  `developer_instructions=${JSON.stringify(agentPrompt(mcp, coordination))}`,
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.url=${JSON.stringify(mcp.url)}`,
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.bearer_token_env_var="HIVEORY_MCP_TOKEN"`,
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.tool_timeout_sec=${Math.round(MCP_TOOL_TIMEOUT_MS / 1000)}`,
  // Pre-approved like Claude's --allowedTools: headless runs would otherwise refuse every call.
  '-c',
  `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode="approve"`,
  // Codex's own browser / computer-use tools would win over Hiveory's; this launch only, user config untouched.
  ...(mcp.browser
    ? [
        ...CODEX_OWN_BROWSER_FEATURES.flatMap((feature) => ['-c', `features.${feature}=false`]),
        ...CODEX_OWN_BROWSER_PLUGINS.flatMap((plugin) => ['-c', `plugins.${plugin}.enabled=false`])
      ]
    : [])
]

const CODEX_OWN_BROWSER_FEATURES = ['browser_use', 'browser_use_external', 'computer_use', 'in_app_browser']
/** Bundled plugins that bring their own browser (the `cua_repl` server). */
const CODEX_OWN_BROWSER_PLUGINS = ['browser@openai-bundled', 'chrome@openai-bundled', 'computer-use@openai-bundled', 'unified-computer-use@openai-bundled']
