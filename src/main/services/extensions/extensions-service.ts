import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import type { ExtensionsInventory, McpServerInfo, SkillInfo } from '@shared/domain/extensions'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'

/** Skill directories and the CLIs that read them (Agent Skills standard + vendor folders). */
export const SKILL_ROOTS: Array<{ dir: string; visibleTo: string[] }> = [
  { dir: '.agents/skills', visibleTo: ['codex', 'copilot', 'cursor', 'gemini', 'opencode', 'kilocode', 'amp', 'goose', 'letta', 'qwen'] },
  { dir: '.claude/skills', visibleTo: ['claude', 'cursor', 'opencode', 'kilocode', 'copilot'] },
  { dir: '.codex/skills', visibleTo: ['codex', 'cursor'] },
  { dir: '.cursor/skills', visibleTo: ['cursor'] }
]

/** Parses `name:` / `description:` from SKILL.md YAML frontmatter (single-line values). */
export const parseSkillFrontmatter = (text: string): { name?: string; description?: string } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return {}
  const out: { name?: string; description?: string } = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const kv = /^(name|description):\s*(.*)$/.exec(line)
    if (kv) out[kv[1] as 'name' | 'description'] = (kv[2] ?? '').trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/** Server names and targets from `[mcp_servers.<name>]` tables in Codex's config.toml. */
export const parseCodexMcp = (toml: string): Array<{ name: string; target?: string; transport: McpServerInfo['transport'] }> => {
  const out: Array<{ name: string; target?: string; transport: McpServerInfo['transport'] }> = []
  const blocks = toml.split(/^\[/m)
  for (const block of blocks) {
    const header = /^mcp_servers\.("?)([^\]"]+)\1\]\s*$/m.exec(block.split(/\r?\n/)[0] ?? '')
    if (!header) continue
    const url = /^url\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    const command = /^command\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    out.push({ name: header[2] as string, target: url ?? command, transport: url ? 'http' : command ? 'stdio' : 'unknown' })
  }
  return out
}

/** Strips // and /* *\/ comments and trailing commas so JSONC configs parse. */
export const parseJsonc = (text: string): unknown => {
  const noComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str: string) => str ?? '')
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, '$1'))
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const describeServer = (config: unknown): { target?: string; transport: McpServerInfo['transport'] } => {
  const c = asRecord(config)
  const url = typeof c.url === 'string' ? c.url : typeof c.httpUrl === 'string' ? c.httpUrl : undefined
  const command = Array.isArray(c.command) ? c.command.join(' ') : typeof c.command === 'string' ? c.command : undefined
  return { target: url ?? command, transport: url || c.type === 'remote' || c.type === 'http' ? 'http' : command ? 'stdio' : 'unknown' }
}

/**
 * Read-only inventory of Agent Skills and MCP servers across installed CLIs
 * (each CLI keeps its own config; Hiveory never rewrites them). The only write
 * is an explicit "share this skill with every agent" copy into ~/.agents/skills.
 */
export class ExtensionsService {
  private lastSkills: SkillInfo[] = []

  constructor(
    private readonly log: Logger,
    private readonly home = homedir()
  ) {}

  scan(projectPath?: string): ExtensionsInventory {
    const skills = [...this.scanSkills(this.home, 'user'), ...(projectPath ? this.scanSkills(projectPath, 'project') : [])]
    this.lastSkills = skills
    return { skills, mcpServers: this.scanMcp(projectPath) }
  }

  /** Copies a scanned skill into ~/.agents/skills so every standards-following CLI loads it. */
  shareSkill(skillPath: string): string {
    const skill = this.lastSkills.find((s) => resolve(s.path) === resolve(skillPath))
    if (!skill) fail('NOT_FOUND', 'Skill not found. Refresh the list and try again.')
    const target = join(this.home, '.agents', 'skills', basename(skill!.path))
    if (resolve(target) === resolve(skill!.path)) return target
    if (existsSync(target)) fail('INVALID_INPUT', `A skill named "${basename(target)}" is already shared.`)
    cpSync(skill!.path, target, { recursive: true, errorOnExist: true })
    return target
  }

  /** Folder to reveal for a scanned skill (only paths from the last scan are allowed). */
  skillFolder(skillPath: string): string {
    const skill = this.lastSkills.find((s) => resolve(s.path) === resolve(skillPath))
    if (!skill) fail('NOT_FOUND', 'Skill not found.')
    return skill!.path
  }

  private scanSkills(base: string, scope: 'user' | 'project'): SkillInfo[] {
    const found: SkillInfo[] = []
    for (const root of SKILL_ROOTS) {
      const dir = join(base, ...root.dir.split('/'))
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        continue
      }
      for (const entry of entries) {
        const folder = join(dir, entry)
        const file = join(folder, 'SKILL.md')
        try {
          if (!statSync(folder).isDirectory() || !existsSync(file)) continue
          const meta = parseSkillFrontmatter(readFileSync(file, 'utf8').slice(0, 4000))
          found.push({
            name: meta.name || entry,
            description: meta.description,
            path: folder,
            scope,
            source: scope === 'user' ? `~/${root.dir}` : root.dir,
            visibleTo: root.visibleTo
          })
        } catch (error) {
          this.log.warn(`Skipping unreadable skill ${folder}`, error)
        }
      }
    }
    return found.sort((a, b) => a.name.localeCompare(b.name))
  }

  private scanMcp(projectPath?: string): McpServerInfo[] {
    const servers = new Map<string, McpServerInfo>()
    const add = (cliId: string, file: string, scope: 'user' | 'project', name: string, info: ReturnType<typeof describeServer>): void => {
      const existing = servers.get(name) ?? { name, transport: info.transport, target: info.target, configuredIn: [] }
      existing.configuredIn.push({ cliId, file: this.display(file), scope })
      servers.set(name, existing)
    }
    const readJson = (file: string): unknown => {
      try {
        return parseJsonc(readFileSync(file, 'utf8'))
      } catch {
        return undefined
      }
    }

    const claudeFile = join(this.home, '.claude.json')
    const claude = asRecord(readJson(claudeFile))
    for (const [name, cfg] of Object.entries(asRecord(claude.mcpServers))) add('claude', claudeFile, 'user', name, describeServer(cfg))
    if (projectPath) {
      const local = asRecord(asRecord(claude.projects)[projectPath])
      for (const [name, cfg] of Object.entries(asRecord(local.mcpServers))) add('claude', claudeFile, 'project', name, describeServer(cfg))
      const projectMcp = join(projectPath, '.mcp.json')
      for (const [name, cfg] of Object.entries(asRecord(asRecord(readJson(projectMcp)).mcpServers))) {
        add('claude', projectMcp, 'project', name, describeServer(cfg))
      }
    }

    const codexFile = join(this.home, '.codex', 'config.toml')
    try {
      for (const s of parseCodexMcp(readFileSync(codexFile, 'utf8'))) add('codex', codexFile, 'user', s.name, s)
    } catch {
      // No Codex config.
    }

    for (const [cliId, dir] of [
      ['opencode', join(this.home, '.config', 'opencode')],
      ['kilocode', join(this.home, '.config', 'kilo')]
    ] as const) {
      for (const name of ['opencode.json', 'opencode.jsonc', 'kilo.json', 'kilo.jsonc', 'config.json']) {
        const file = join(dir, name)
        if (!existsSync(file)) continue
        for (const [server, cfg] of Object.entries(asRecord(asRecord(readJson(file)).mcp))) add(cliId, file, 'user', server, describeServer(cfg))
      }
    }

    for (const [cliId, file] of [
      ['gemini', join(this.home, '.gemini', 'settings.json')],
      ['qwen', join(this.home, '.qwen', 'settings.json')],
      ['cursor', join(this.home, '.cursor', 'mcp.json')]
    ] as const) {
      for (const [name, cfg] of Object.entries(asRecord(asRecord(readJson(file)).mcpServers))) add(cliId, file, 'user', name, describeServer(cfg))
    }

    return [...servers.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  private display(file: string): string {
    const rel = relative(this.home, file)
    return rel && !rel.startsWith('..') ? `~${sep}${rel}` : file
  }
}
