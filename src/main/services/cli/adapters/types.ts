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
}

export interface LaunchSpec {
  args: string[]
  /** Environment overrides; `undefined` removes a variable. */
  env?: Record<string, string | undefined>
  /** Files the runtime writes before launch. */
  files?: Array<{ path: string; content: string }>
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
  supportsAutoApprove: boolean
  /** The adapter knows how to load Hiveory's MCP server into a session (see `LaunchContext.mcp`). */
  injectMcp?: boolean
  buildLaunch(ctx: LaunchContext): LaunchSpec
  /** Translates a native hook callback into a status event. */
  mapHookEvent?(event: string, payload: unknown): StatusEvent | null
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
