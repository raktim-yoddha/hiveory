import { fail } from '@shared/errors'
import type { McpArg, McpInput, McpOption, McpSearchResult, SkillAudit, StoreMcpServer, StoreSkill } from '@shared/domain/stores'
import { parseSkillFrontmatter } from './extensions-service'

type Fetch = typeof fetch

const SKILLS_API = 'https://skills.sh/api'
/** skills.sh's leaderboard is public only on its home page (its API needs a Vercel account). */
const SKILLS_HOME = 'https://www.skills.sh/'
const TOP_SKILLS = 50
const TOP_CACHE_MS = 10 * 60_000
const REGISTRY_API = 'https://registry.modelcontextprotocol.io/v0.1'
const GITHUB_API = 'https://api.github.com'
const TIMEOUT_MS = 20_000
/** The registry's search is slow (5–20 s); listing is fast. */
const REGISTRY_TIMEOUT_MS = 45_000
/** A skill folder bigger than this is not a skill. */
const MAX_FILES = 100
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 8 * 1024 * 1024
/** SKILL.md files read to find one whose name matches, when no folder is named after it. */
const MAX_NAME_PROBES = 40
const GITHUB_SOURCE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

export interface SkillFiles {
  /** The folder name it installs under. */
  folder: string
  files: Array<{ path: string; data: Buffer }>
}

/** A safe relative path inside a skill folder: no absolute paths, no "..", no empty parts. */
export const safeRelative = (path: string): boolean => !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')

/**
 * The all-time leaderboard from skills.sh's home page data: every skill entry it embeds, most installs
 * first. ponytail: reads the page's embedded data, so a redesign of skills.sh can empty it; the store
 * then shows search only. Upgrade to /api/v1/skills if skills.sh opens it without a Vercel account.
 */
export const parseLeaderboard = (html: string): StoreSkill[] => {
  const text = html.replaceAll('\\"', '"')
  const seen = new Map<string, StoreSkill>()
  for (const m of text.matchAll(/"source":"([^"]{1,200})","skillId":"([^"]{1,128})","name":"([^"]{1,128})","installs":(\d+)/g)) {
    const [, source, skillId, name, installs] = m as unknown as [string, string, string, string, string]
    const id = `${source}/${skillId}`
    if (!seen.has(id)) seen.set(id, { id, source, skillId, name, installs: Number(installs), installable: GITHUB_SOURCE.test(source) })
  }
  return [...seen.values()].sort((a, b) => b.installs - a.installs)
}

/** The skill folder a skills.sh id names: a folder called after it, else the SKILL.md whose name matches. */
export const skillDirOf = async (skillMds: string[], skillId: string, nameOf: (path: string) => Promise<string | undefined>): Promise<string | undefined> => {
  const dirOf = (p: string): string => p.split('/').slice(0, -1).join('/')
  const named = skillMds.find((p) => dirOf(p).split('/').at(-1) === skillId)
  if (named) return dirOf(named)
  for (const path of skillMds.slice(0, MAX_NAME_PROBES)) if ((await nameOf(path)) === skillId) return dirOf(path)
  return skillMds.length === 1 && dirOf(skillMds[0]!) === '' ? '' : undefined
}

/**
 * skills.sh and the official MCP Registry (ADR 0041), read from main only. A skill's files come
 * straight from its GitHub repository (skills.sh's own file API needs a Vercel account); nothing
 * from a store runs until the user installs it, and a server only starts once they add it.
 */
export class StoreService {
  private top: { at: number; skills: StoreSkill[] } | null = null

  constructor(private readonly http: Fetch = fetch) {}

  /** The most installed skills on skills.sh, kept for ten minutes. */
  async topSkills(): Promise<StoreSkill[]> {
    if (this.top && Date.now() - this.top.at < TOP_CACHE_MS) return this.top.skills
    const response = await this.get('skills.sh', SKILLS_HOME)
    if (!response.ok) fail('INVALID_INPUT', `skills.sh answered ${response.status}.`)
    const skills = parseLeaderboard(await response.text()).slice(0, TOP_SKILLS)
    this.top = { at: Date.now(), skills }
    return skills
  }

  async searchSkills(query: string): Promise<StoreSkill[]> {
    const q = query.trim()
    if (q.length < 2) return []
    const out = await this.json<{ skills?: Array<{ id: string; source: string; skillId: string; name: string; installs?: number }> }>('skills.sh', `${SKILLS_API}/search?q=${encodeURIComponent(q)}&limit=40`)
    return (out.skills ?? []).map((s) => ({ id: s.id, source: s.source, skillId: s.skillId, name: s.name, installs: s.installs ?? 0, installable: GITHUB_SOURCE.test(s.source) }))
  }

  /** Partner audits (Snyk, Socket…); none yet is an empty list, not an error. */
  async skillAudits(id: string): Promise<SkillAudit[]> {
    if (!id.split('/').every((p) => SKILL_ID.test(p))) fail('INVALID_INPUT', 'That is not a skills.sh skill.')
    const response = await this.get('skills.sh', `${SKILLS_API}/v1/skills/audit/${id.split('/').map(encodeURIComponent).join('/')}`)
    if (response.status === 404) return []
    if (!response.ok) fail('INVALID_INPUT', `skills.sh answered ${response.status}.`)
    const out = (await response.json()) as { audits?: Array<{ provider: string; status: string; summary?: string; riskLevel?: string }> }
    return (out.audits ?? []).map((a) => ({ provider: a.provider, status: a.status === 'fail' ? 'fail' : a.status === 'warn' ? 'warn' : 'pass', summary: a.summary ?? '', ...(a.riskLevel ? { riskLevel: a.riskLevel } : {}) }))
  }

  /** Downloads a skill's folder from its GitHub repository (the default branch). */
  async downloadSkill(source: string, skillId: string): Promise<SkillFiles> {
    if (!GITHUB_SOURCE.test(source) || !SKILL_ID.test(skillId)) fail('INVALID_INPUT', 'Only skills from GitHub repositories can be installed here.')
    const tree = await this.json<{ tree?: Array<{ path: string; type: string; size?: number }>; truncated?: boolean }>('GitHub', `${GITHUB_API}/repos/${source}/git/trees/HEAD?recursive=1`)
    const blobs = (tree.tree ?? []).filter((t) => t.type === 'blob')
    const raw = (path: string): string => `https://raw.githubusercontent.com/${source}/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`
    const skillMds = blobs.filter((b) => b.path === 'SKILL.md' || b.path.endsWith('/SKILL.md')).map((b) => b.path)
    const dir = await skillDirOf(skillMds, skillId, async (path) => {
      const response = await this.get('GitHub', raw(path))
      return response.ok ? parseSkillFrontmatter(await response.text()).name : undefined
    })
    if (dir === undefined) fail('NOT_FOUND', `${source} has no skill named ${skillId}.`)
    const prefix = dir ? `${dir}/` : ''
    const mine = blobs.filter((b) => b.path.startsWith(prefix) && safeRelative(b.path.slice(prefix.length)))
    if (mine.length > MAX_FILES) fail('INVALID_INPUT', `That skill has more than ${MAX_FILES} files.`)
    let total = 0
    const files: SkillFiles['files'] = []
    for (const blob of mine) {
      if ((blob.size ?? 0) > MAX_FILE_BYTES) continue
      const response = await this.get('GitHub', raw(blob.path))
      if (!response.ok) fail('INVALID_INPUT', `GitHub answered ${response.status} for ${blob.path}.`)
      const data = Buffer.from(await response.arrayBuffer())
      total += data.length
      if (total > MAX_TOTAL_BYTES) fail('INVALID_INPUT', 'That skill is too large to install.')
      files.push({ path: blob.path.slice(prefix.length), data })
    }
    if (!files.some((f) => f.path === 'SKILL.md')) fail('NOT_FOUND', `${skillId} has no SKILL.md.`)
    return { folder: skillId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'skill', files }
  }

  /** The official MCP Registry's latest servers matching `query` (all of them, newest first, when empty). */
  async searchMcp(query: string, cursor?: string): Promise<McpSearchResult> {
    // Searching with version=latest is far slower on the registry; search every version and keep the latest.
    const params = new URLSearchParams(query.trim() ? { search: query.trim(), limit: '100' } : { version: 'latest', limit: '30' })
    if (cursor) params.set('cursor', cursor)
    const out = await this.json<{ servers?: Array<{ server: RegistryServer; _meta?: Record<string, { isLatest?: boolean } | undefined> }>; metadata?: { nextCursor?: string } }>(
      'the MCP Registry',
      `${REGISTRY_API}/servers?${params}`,
      REGISTRY_TIMEOUT_MS
    )
    const servers = (out.servers ?? [])
      .filter((s) => s._meta?.['io.modelcontextprotocol.registry/official']?.isLatest !== false)
      .map((s) => serverOf(s.server))
      .filter((s): s is StoreMcpServer => Boolean(s?.options.length))
    return { servers, ...(out.metadata?.nextCursor ? { next: out.metadata.nextCursor } : {}) }
  }

  private async get(service: string, url: string, timeout = TIMEOUT_MS): Promise<Response> {
    try {
      return await this.http(url, { headers: { Accept: 'application/json', 'User-Agent': 'Hiveory' }, signal: AbortSignal.timeout(timeout) })
    } catch {
      return fail('INVALID_INPUT', `Could not reach ${service}.`, { hint: 'Check your connection and try again.' })
    }
  }

  private async json<T>(service: string, url: string, timeout?: number): Promise<T> {
    const response = await this.get(service, url, timeout)
    if (response.status === 403 && service === 'GitHub') fail('FORBIDDEN', 'GitHub limits downloads without an account for an hour.', { hint: 'Try again later.' })
    if (!response.ok) fail('INVALID_INPUT', `${service} answered ${response.status}.`)
    return (await response.json()) as T
  }
}

interface RegistryInput {
  name?: string
  description?: string
  isRequired?: boolean
  isSecret?: boolean
  default?: string
  value?: string
  valueHint?: string
  choices?: string[]
  type?: string
  format?: string
  variables?: Record<string, RegistryInput>
}

interface RegistryServer {
  name: string
  title?: string
  description?: string
  version: string
  repository?: { url?: string }
  packages?: Array<{ registryType?: string; identifier?: string; version?: string; transport?: { type?: string }; environmentVariables?: RegistryInput[]; runtimeArguments?: RegistryInput[]; packageArguments?: RegistryInput[] }>
  remotes?: Array<{ type?: string; url?: string; headers?: RegistryInput[] }>
}

const inputOf = (i: RegistryInput, fallback: string): McpInput => ({
  name: i.name ?? i.valueHint ?? fallback,
  ...(i.description ? { description: i.description } : {}),
  required: Boolean(i.isRequired),
  secret: Boolean(i.isSecret),
  ...(i.default !== undefined ? { default: String(i.default) } : {}),
  ...(i.choices?.length ? { choices: i.choices.map(String) } : {})
})

const argOf = (a: RegistryInput, index: number): McpArg => {
  const name = a.type === 'named' ? a.name : undefined
  if (a.value !== undefined) return { ...(name ? { name } : {}), value: String(a.value), ...(a.variables ? { vars: Object.entries(a.variables).map(([k, v]) => inputOf({ ...v, name: k }, k)) } : {}) }
  // A named boolean flag (docker's -i, --rm) is just the flag; anything else is a value the user gives.
  if (name && a.format === 'boolean') return { name }
  return { ...(name ? { name } : {}), input: inputOf({ ...a, name: a.valueHint ?? a.name ?? `argument ${index + 1}` }, `argument ${index + 1}`) }
}

/** A registry entry as the store shows it; packages Hiveory cannot run (nuget, mcpb, local HTTP) are left out. */
export const serverOf = (s: RegistryServer): StoreMcpServer | null => {
  if (!s?.name) return null
  const packages: McpOption[] = (s.packages ?? []).flatMap((p): McpOption[] => {
    const registry = p.registryType === 'npm' || p.registryType === 'pypi' || p.registryType === 'oci' ? p.registryType : undefined
    if (!registry || !p.identifier || (p.transport?.type && p.transport.type !== 'stdio')) return []
    return [
      {
        kind: 'package',
        registry,
        identifier: p.identifier,
        ...(p.version ? { version: p.version } : {}),
        env: (p.environmentVariables ?? []).map((e, i) => inputOf(e, `VAR_${i + 1}`)),
        runtimeArgs: registry === 'oci' ? (p.runtimeArguments ?? []).map(argOf) : [],
        args: (p.packageArguments ?? []).map(argOf)
      }
    ]
  })
  const remotes: McpOption[] = (s.remotes ?? []).flatMap((r): McpOption[] =>
    (r.type === 'streamable-http' || r.type === 'sse') && r.url && /^https:\/\//.test(r.url) && !r.url.includes('{')
      ? [{ kind: 'remote', transport: r.type, url: r.url, headers: (r.headers ?? []).map((h, i) => ({ ...inputOf(h, `Header ${i + 1}`), ...(h.value && !h.value.includes('{') ? { default: h.value } : {}) })) }]
      : []
  )
  return {
    name: s.name,
    ...(s.title ? { title: s.title } : {}),
    description: s.description ?? '',
    version: s.version,
    ...(s.repository?.url && /^https:\/\/github\.com\//.test(s.repository.url) ? { repository: s.repository.url } : {}),
    options: [...packages, ...remotes]
  }
}
