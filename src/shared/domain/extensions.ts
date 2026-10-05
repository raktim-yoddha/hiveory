/** A skills directory and the CLIs that load skills from it. */
export interface SkillRoot {
  id: 'agents' | 'claude' | 'codex' | 'cursor'
  /** Relative to the home folder (user scope) or the project (project scope), e.g. ".agents/skills". */
  dir: string
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
 * An MCP server Hiveory runs for every agent it launches — a plugin set up
 * with the user's keys, a server added by hand, or one imported from a CLI's
 * config (ADR 0017). Secrets stay in main; this view never carries them.
 */
export interface ConnectionView {
  id: string
  name: string
  /** Set when made from a plugin in the catalog. */
  pluginId?: string
  enabled: boolean
  transport: 'stdio' | 'http'
  /** Command line or URL without secrets. */
  target: string
  /** Plugin fields that are not secret. */
  values: Record<string, string>
  /** Plugin fields, env vars and headers that hold a value (the values stay in main). */
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

/** What the local runners plugins use are installed. */
export interface ConnectionRequirements {
  npx: boolean
  uvx: boolean
}
