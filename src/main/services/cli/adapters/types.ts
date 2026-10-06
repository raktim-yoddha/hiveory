import type { CliInstance, IconReference } from '@shared/domain'
import type { HeuristicConfig } from '../status/heuristics'
import type { StatusEvent } from '../status/status-machine'

export interface HookEndpoint {
  baseUrl: string
  token: string
}

/** Per-agent endpoint of Hiveory's MCP server (agent tools), loopback HTTP with a bearer token. */
export interface McpEndpoint {
  url: string
  token: string
  /** Browser use is on: the agent gets browser_* tools and is told to use them for websites. */
  browser?: boolean
  /** Computer use is on: the agent gets computer_* tools for the desktop. */
  computer?: boolean
  /** Coordination tools (list_agents, send_message…) are on; false when only browser, computer or apps are served. */
  coordination?: boolean
  /** Plugins / MCP servers served through Hiveory (ADR 0017), by name. */
  apps?: string[]
  /** A bot's thread (ADR 0022): memory tools, plus team tools for the Chief of Staff or a bot allowed to message. */
  bot?: 'chief' | 'member' | 'solo'
}

export interface LaunchContext {
  instance: CliInstance
  cwd: string
  autoApprove: boolean
  /** Present when the hook server is running. */
  hook?: HookEndpoint
  /** Present when agent tools are enabled and this adapter can load an MCP server. */
  mcp?: McpEndpoint
  /** Per-instance directory for generated files (e.g. hook settings). */
  runtimeDir: string
  /** Continue this agent's earlier conversation instead of starting a new one. */
  resume: boolean
  /**
   * This is the only agent of its CLI in the folder, so "continue the most
   * recent session here" unambiguously means this agent's own session.
   */
  soleOfCli: boolean
}

export interface LaunchSpec {
  args: string[]
  /** Environment overrides; `undefined` removes a variable. */
  env?: Record<string, string | undefined>
  /** Files the runtime writes before launch. */
  files?: Array<{ path: string; content: string }>
}

/**
 * Where a CLI loads Agent Skills from (folders with SKILL.md). `dir` is its own folder
 * under the home folder; `projectDir` its folder inside a project when that differs.
 * `shared` means it also reads the cross-agent `.agents/skills`; `alsoReads` lists other
 * CLIs' folders it loads too (e.g. Cursor reads `.claude/skills`).
 */
export interface SkillFolders {
  dir?: string
  projectDir?: string | null
  shared?: boolean
  alsoReads?: string[]
}

/**
 * Everything provider-specific lives behind this contract (AGENTS.md rule 5).
 * Process lifecycle itself is generic and owned by CliRuntimeManager.
 */
export interface CliAdapter {
  id: string
  displayName: string
  icon: IconReference
  /** Executable names looked up on PATH, in priority order. */
  executables: string[]
  /** Finds the executable when PATH lookup can't (e.g. Git Bash beside git.exe). */
  locate?(env: import('../discovery').DiscoveryEnv): string | undefined
  /** A plain shell, not an agent: no Kanban card, no chat, listed first when adding panes. */
  kind?: 'shell'
  supportsAutoApprove: boolean
  /** Agent Skills folders this CLI reads (Settings › Skills); absent: it has no skills support. */
  skills?: SkillFolders
  /** Keys that stop the current task without quitting. Default: Esc for agents, Ctrl+C for shells. */
  interruptKeys?: string
  /** The adapter knows how to load Hiveory's MCP server into a session (see `LaunchContext.mcp`). */
  injectMcp?: boolean
  buildLaunch(ctx: LaunchContext): LaunchSpec
  /** Translates a native hook callback into a status event. */
  mapHookEvent?(event: string, payload: unknown): StatusEvent | null
  /** The CLI's session id carried by a hook callback, if any (stored for exact resume). */
  sessionIdFromHook?(event: string, payload: unknown): string | undefined
  /**
   * Resuming a conversation from the CLI's history (Sessions tab): where the session id
   * goes on a new agent so `buildLaunch` resumes it. Absent: the CLI can't resume by id.
   */
  adoptSession?(sessionId: string): Pick<CliInstance, 'conversationId'> | Pick<CliInstance, 'providerSessionId'>
  /** PTY heuristics; `hooksActive` says whether native hooks are reporting too. */
  heuristics(hooksActive: boolean): HeuristicConfig | null
}

/** Shell-agnostic hook command (bash, cmd and PowerShell all accept it): POSTs stdin JSON. */
export const curlHookCommand = (hook: HookEndpoint, instanceId: string, event: string): string =>
  [
    'curl -s -m 2 -X POST',
    `-H "X-Hiveory-Token: ${hook.token}"`,
    '-H "Content-Type: application/json"',
    '--data-binary "@-"',
    `"${hook.baseUrl}/hooks/${instanceId}/${event}"`
  ].join(' ')

export const field = (payload: unknown, key: string): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}
