/** An Agent Skill (a folder with SKILL.md — the cross-agent standard). */
export interface SkillInfo {
  name: string
  description?: string
  /** Absolute folder path. */
  path: string
  scope: 'user' | 'project'
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
  skills: SkillInfo[]
  mcpServers: McpServerInfo[]
}
