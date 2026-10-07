import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import type { ExtensionsInventory, McpServerInfo, SkillInfo, SkillRoot } from '@shared/domain/extensions'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import { BUILT_IN_ADAPTERS } from '../cli/adapters'
import type { CliAdapter } from '../cli/adapters/types'

/** Short chip label: "Gemini CLI" → "Gemini", "Kilo Code CLI" → "Kilo Code". */
const shortName = (name: string): string => name.replace(/ CLI$/, '').replace(/^GitHub /, '')

/**
 * Skills folders, built from the CLI registry (AGENTS.md rule 15): the shared
 * `.agents/skills` (the Agent Skills standard) first, then each CLI's own folder
 * with every CLI that reads it.
 */
export function skillRoots(adapters: Array<Pick<CliAdapter, 'id' | 'displayName' | 'skills'>>): SkillRoot[] {
  const withSkills = adapters.filter((a) => a.skills)
  const roots: SkillRoot[] = [{ id: 'agents', dir: '.agents/skills', label: 'Shared (.agents)', visibleTo: withSkills.filter((a) => a.skills!.shared).map((a) => a.id) }]
  for (const a of withSkills) {
    const dir = a.skills!.dir
    if (!dir || roots.some((r) => r.dir === dir)) continue
    roots.push({
      id: a.id,
      dir,
      ...(a.skills!.projectDir !== undefined ? { projectDir: a.skills!.projectDir } : {}),
      label: shortName(a.displayName),
      visibleTo: [a.id, ...withSkills.filter((b) => b.id !== a.id && (b.skills!.dir === dir || b.skills!.alsoReads?.includes(dir))).map((b) => b.id)]
    })
  }
  return roots
}

/** Where a root lives in a scope, or null when the CLI has no project folder of its own. */
const rootPath = (root: SkillRoot, scope: 'user' | 'project'): string | null => (scope === 'user' ? root.dir : root.projectDir === undefined ? root.dir : root.projectDir)

/** A server's full config as a CLI stores it — kept in main for "use in every agent", never sent to the renderer. */
export interface McpRawConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

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

/** `KEY = "value"` pairs of a TOML inline table or table body. */
const tomlPairs = (text: string): Record<string, string> =>
  Object.fromEntries([...text.matchAll(/^\s*"?([\w-]+)"?\s*=\s*"((?:\\.|[^"\\])*)"/gm)].map((m) => [m[1] as string, (m[2] as string).replace(/\\(.)/g, '$1')]))

const tomlStrings = (text: string): string[] => [...text.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1'))

/** Servers from `[mcp_servers.<name>]` tables in Codex's config.toml (including `.env` sub-tables). */
export const parseCodexMcp = (
  toml: string
): Array<{ name: string; target?: string; transport: McpServerInfo['transport']; config: McpRawConfig }> => {
  const out = new Map<string, { name: string; target?: string; transport: McpServerInfo['transport']; config: McpRawConfig }>()
  for (const block of toml.split(/^\[/m)) {
    const header = /^mcp_servers\.("?)([^\]"]+?)\1(\.(env|http_headers))?\]\s*$/m.exec(block.split(/\r?\n/)[0] ?? '')
    if (!header) continue
    const name = header[2] as string
    const body = block.split(/\r?\n/).slice(1).join('\n')
    const entry = out.get(name) ?? { name, transport: 'unknown' as const, config: {} }
    if (header[4] === 'env') entry.config.env = { ...entry.config.env, ...tomlPairs(body) }
    else if (header[4] === 'http_headers') entry.config.headers = { ...entry.config.headers, ...tomlPairs(body) }
    else {
      const url = /^url\s*=\s*"([^"]+)"/m.exec(body)?.[1]
      const command = /^command\s*=\s*"([^"]+)"/m.exec(body)?.[1]
      const args = /^args\s*=\s*\[([\s\S]*?)\]/m.exec(body)?.[1]
      const env = /^env\s*=\s*\{([^}]*)\}/m.exec(body)?.[1]
      const headers = /^http_headers\s*=\s*\{([^}]*)\}/m.exec(body)?.[1]
      entry.target = url ?? command
      entry.transport = url ? 'http' : command ? 'stdio' : 'unknown'
      entry.config = {
        ...entry.config,
        ...(url ? { url } : {}),
        ...(command ? { command } : {}),
        ...(args !== undefined ? { args: tomlStrings(args) } : {}),
        ...(env ? { env: { ...entry.config.env, ...tomlPairs(env.replace(/,/g, '\n')) } } : {}),
        ...(headers ? { headers: { ...entry.config.headers, ...tomlPairs(headers.replace(/,/g, '\n')) } } : {})
      }
    }
    out.set(name, entry)
  }
  return [...out.values()]
}

/** Strips // and /* *\/ comments and trailing commas so JSONC configs parse. */
export const parseJsonc = (text: string): unknown => {
  const noComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str: string) => str ?? '')
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, '$1'))
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const stringRecord = (value: unknown): Record<string, string> | undefined => {
  const entries = Object.entries(asRecord(value)).filter((e): e is [string, string] => typeof e[1] === 'string')
  return entries.length ? Object.fromEntries(entries) : undefined
}

/** Reads the JSON shapes Claude, Gemini, Cursor, Qwen and OpenCode use for one server. */
export const rawFromJson = (config: unknown): McpRawConfig => {
  const c = asRecord(config)
  const url = typeof c.url === 'string' ? c.url : typeof c.httpUrl === 'string' ? c.httpUrl : undefined
  const list = Array.isArray(c.command) ? c.command.filter((x): x is string => typeof x === 'string') : undefined
  const command = list ? list[0] : typeof c.command === 'string' ? c.command : undefined
  const args = list ? list.slice(1) : Array.isArray(c.args) ? c.args.filter((x): x is string => typeof x === 'string') : undefined
  return {
    ...(url ? { url } : {}),
    ...(command ? { command } : {}),
    ...(args?.length ? { args } : {}),
    ...(stringRecord(c.env ?? c.environment) ? { env: stringRecord(c.env ?? c.environment) } : {}),
    ...(stringRecord(c.headers) ? { headers: stringRecord(c.headers) } : {})
  }
}

const describeServer = (config: unknown): { target?: string; transport: McpServerInfo['transport']; config: McpRawConfig } => {
  const raw = rawFromJson(config)
  const c = asRecord(config)
  const target = raw.url ?? (raw.command ? [raw.command, ...(raw.args ?? [])].join(' ') : undefined)
  return { target, transport: raw.url || c.type === 'remote' || c.type === 'http' ? 'http' : raw.command ? 'stdio' : 'unknown', config: raw }
}

const CLI_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', kilocode: 'Kilo Code', gemini: 'Gemini CLI', qwen: 'Qwen Code', cursor: 'Cursor' }

/**
 * Agent Skills and MCP servers across installed CLIs. CLI configs are only
 * read; skills are written only on an explicit action (copy into another
 * skills folder, create, import, move one copy to the trash).
 */
export class ExtensionsService {
  private lastSkills: SkillInfo[] = []
  private lastRaw = new Map<string, { config: McpRawConfig; from: string }>()

  constructor(
    private readonly log: Logger,
    private readonly home = homedir(),
    private readonly trash: (path: string) => Promise<void> = async () => fail('FORBIDDEN', 'Trash is not available.'),
    private readonly roots: SkillRoot[] = skillRoots(BUILT_IN_ADAPTERS)
  ) {}

  scan(projectPath?: string): ExtensionsInventory {
    const skills = [...this.scanSkills(this.home, 'user'), ...(projectPath ? this.scanSkills(projectPath, 'project') : [])]
    this.lastSkills = skills
    return { roots: this.roots, skills, mcpServers: this.scanMcp(projectPath) }
  }

  private known(skillPath: string): SkillInfo {
    const skill = this.lastSkills.find((s) => resolve(s.path) === resolve(skillPath))
    if (!skill) fail('NOT_FOUND', 'Skill not found. Refresh the list and try again.')
    return skill!
  }

  private rootDir(rootId: SkillRoot['id'], base: string, scope: 'user' | 'project'): string {
    const root = this.roots.find((r) => r.id === rootId)
    if (!root) fail('INVALID_INPUT', `Unknown skills folder: ${rootId}`)
    const dir = rootPath(root!, scope)
    if (!dir) fail('INVALID_INPUT', `${root!.label} reads workspace skills from the shared folder. Use Shared (.agents).`)
    return join(base, ...dir!.split('/'))
  }

  /** Copies a scanned skill into another skills folder of the same scope, so the CLIs reading it load it too. */
  copySkill(skillPath: string, rootId: SkillRoot['id'], projectPath?: string): string {
    const skill = this.known(skillPath)
    const base = skill.scope === 'user' ? this.home : projectPath
    if (!base) fail('INVALID_INPUT', 'Open the workspace this skill belongs to first.')
    const target = join(this.rootDir(rootId, base!, skill.scope), skill.folder)
    if (resolve(target) === resolve(skill.path)) return target
    if (existsSync(target)) fail('INVALID_INPUT', `${this.roots.find((r) => r.id === rootId)?.label} already has a skill named "${skill.folder}".`)
    cpSync(skill.path, target, { recursive: true, errorOnExist: true })
    return target
  }

  /** Moves one copy of a scanned skill to the OS trash (recoverable). */
  async removeSkill(skillPath: string): Promise<void> {
    await this.trash(this.known(skillPath).path)
  }

  /** Writes a new SKILL.md into each chosen skills folder. */
  createSkill(input: { name: string; description: string; body: string; rootIds: SkillRoot['id'][] }, projectPath?: string): string[] {
    const base = projectPath ?? this.home
    const targets = input.rootIds.map((id) => join(this.rootDir(id, base, projectPath ? 'project' : 'user'), input.name))
    const taken = targets.find((t) => existsSync(t))
    if (taken) fail('INVALID_INPUT', `A skill named "${input.name}" already exists in ${relative(base, taken)}.`)
    const description = input.description.replace(/\s+/g, ' ')
    const content = `---\nname: ${input.name}\ndescription: ${JSON.stringify(description)}\n---\n\n${input.body.trim()}\n`
    for (const target of targets) {
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'SKILL.md'), content)
    }
    return targets
  }

  /** Copies a skill folder (containing SKILL.md) chosen by the user into each chosen skills folder. */
  importSkill(folder: string, rootIds: SkillRoot['id'][], projectPath?: string): string[] {
    if (!existsSync(join(folder, 'SKILL.md'))) fail('INVALID_INPUT', 'That folder has no SKILL.md. Choose a skill folder.')
    const base = projectPath ?? this.home
    const name = basename(folder)
    const targets = rootIds.map((id) => join(this.rootDir(id, base, projectPath ? 'project' : 'user'), name)).filter((t) => resolve(t) !== resolve(folder))
    const taken = targets.find((t) => existsSync(t))
    if (taken) fail('INVALID_INPUT', `A skill named "${name}" already exists in ${relative(base, taken)}.`)
    for (const target of targets) cpSync(folder, target, { recursive: true, errorOnExist: true })
    return targets
  }

  /** Folder to reveal for a scanned skill (only paths from the last scan are allowed). */
  skillFolder(skillPath: string): string {
    return this.known(skillPath).path
  }

  /** The full config of a server from the last scan (first CLI that defines it). */
  rawServer(name: string): { config: McpRawConfig; from: string } {
    const found = this.lastRaw.get(name)
    if (!found) fail('NOT_FOUND', 'Server not found. Refresh the list and try again.')
    return found!
  }

  private scanSkills(base: string, scope: 'user' | 'project'): SkillInfo[] {
    const found: SkillInfo[] = []
    for (const root of this.roots) {
      const rel = rootPath(root, scope)
      if (!rel) continue
      const dir = join(base, ...rel.split('/'))
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
            folder: entry,
            scope,
            rootId: root.id,
            source: scope === 'user' ? `~/${rel}` : rel,
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
    this.lastRaw = new Map()
    const add = (cliId: string, file: string, scope: 'user' | 'project', name: string, info: ReturnType<typeof describeServer>): void => {
      const existing = servers.get(name) ?? { name, transport: info.transport, target: info.target, configuredIn: [] }
      existing.configuredIn.push({ cliId, file: this.display(file), scope })
      servers.set(name, existing)
      if (!this.lastRaw.has(name) && (info.config.command || info.config.url)) this.lastRaw.set(name, { config: info.config, from: CLI_NAMES[cliId] ?? cliId })
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
