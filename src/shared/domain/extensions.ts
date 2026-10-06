/** A skills directory and the CLIs that load skills from it. */
export interface SkillRoot {
  /** `agents` for the shared folder, otherwise the id of the CLI that owns the folder. */
  id: string
  /** Relative to the home folder (user scope), e.g. ".gemini/skills". */
  dir: string
  /** Relative to a project (project scope), when it differs from `dir`; null: no project folder of its own. */
  projectDir?: string | null
  label: string
  visibleTo: string[]
}

/** An Agent Skill (a folder with SKILL.md — the cross-agent standard). */
export interface SkillInfo {
  name: string
  description?: string
  /** Absolute folder path. */
  path: string
  /** Folder name; copies of one skill in several roots share it. */
  folder: string
  scope: 'user' | 'project'
  rootId: SkillRoot['id']
  /** Which skills directory it was found in, e.g. "~/.agents/skills". */
  source: string
  /** CLI ids that load skills from that directory. */
  visibleTo: string[]
}

/** An MCP server configured in one or more CLIs. */
export interface McpServerInfo {
  name: string
  transport: 'stdio' | 'http' | 'unknown'
  /** Command or URL, for display only. */
  target?: string
  /** CLI id → where it is configured. */
  configuredIn: Array<{ cliId: string; file: string; scope: 'user' | 'project' }>
}

export interface ExtensionsInventory {
  roots: SkillRoot[]
  skills: SkillInfo[]
  mcpServers: McpServerInfo[]
}

/**
 * An MCP server Hiveory runs for every agent it launches — the user's Composio
 * account (ADR 0023), a server added by hand, or one imported from a CLI's
 * config (ADR 0017). Secrets stay in main; this view never carries them.
 */
export interface ConnectionView {
  id: string
  name: string
  /** 'composio' for the Composio account that serves the plugins. */
  pluginId?: string
  /** Apps with an active account in Composio (toolkit slugs). */
  apps?: string[]
  enabled: boolean
  transport: 'stdio' | 'http'
  /** Command line or URL without secrets. */
  target: string
  /** Env vars and headers that hold a value (the values stay in main). */
  secretsSet: string[]
  envKeys: string[]
  headerKeys: string[]
  /** Tools as the agents see them, prefixed with the connection's tool prefix. */
  tools: Array<{ name: string; description?: string }>
  state: 'untested' | 'connecting' | 'ready' | 'error'
  error?: string
  /** "Claude Code" etc. for servers imported from a CLI. */
  importedFrom?: string
}

