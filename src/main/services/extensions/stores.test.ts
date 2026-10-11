import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { connectionFor, coveringRoots, optionInputs, type McpOption } from '@shared/domain/stores'
import { ExtensionsService } from './extensions-service'
import { parseLeaderboard, safeRelative, serverOf, skillDirOf, StoreService } from './store-service'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never

describe('installing a skill for every CLI', () => {
  it('picks the fewest folders that reach every installed CLI', () => {
    const roots = [
      { id: 'agents', visibleTo: ['codex', 'gemini', 'opencode'] },
      { id: 'claude', visibleTo: ['claude'] },
      { id: 'gemini', visibleTo: ['gemini'] },
      { id: 'kiro', visibleTo: ['kiro'] }
    ]
    expect(coveringRoots(roots, new Set(['claude', 'codex', 'gemini']))).toEqual(['agents', 'claude'])
    expect(coveringRoots(roots, new Set())).toEqual(['agents'])
  })

  it('finds the skill folder by name, then by its SKILL.md name', async () => {
    expect(await skillDirOf(['skills/pdf/SKILL.md', 'skills/docx/SKILL.md'], 'pdf', async () => undefined)).toBe('skills/pdf')
    const names: Record<string, string> = { 'skills/react-best-practices/SKILL.md': 'vercel-react-best-practices' }
    expect(await skillDirOf(Object.keys(names), 'vercel-react-best-practices', async (p) => names[p])).toBe('skills/react-best-practices')
    expect(await skillDirOf(['SKILL.md'], 'whatever', async () => 'other')).toBe('')
    expect(await skillDirOf(['a/SKILL.md'], 'missing', async () => 'other')).toBeUndefined()
  })

  it('keeps every file inside the skill folder', () => {
    expect(safeRelative('rules/a.md')).toBe(true)
    expect(safeRelative('../escape.md')).toBe(false)
    expect(safeRelative('/etc/passwd')).toBe(false)
    expect(safeRelative('C:/x')).toBe(false)
    expect(safeRelative('a//b')).toBe(false)
  })

  it('downloads only the skill folder from GitHub and writes it into each chosen folder', async () => {
    const repo: Record<string, string> = { 'skills/pdf/SKILL.md': '---\nname: pdf\n---\nUse it.', 'skills/pdf/scripts/run.py': 'print(1)', 'skills/docx/SKILL.md': '---\nname: docx\n---' }
    const http = (async (url: string) => {
      if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(repo).map((path) => ({ path, type: 'blob', size: 10 })) }))
      const path = decodeURIComponent(url.split('/HEAD/')[1] ?? '')
      return repo[path] !== undefined ? new Response(repo[path]) : new Response('', { status: 404 })
    }) as typeof fetch
    const skill = await new StoreService(http).downloadSkill('acme/skills', 'pdf')
    expect(skill.folder).toBe('pdf')
    expect(skill.files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'scripts/run.py'])
    const home = mkdtempSync(join(tmpdir(), 'hv-store-'))
    const targets = new ExtensionsService(log, home).installFiles(skill, ['agents', 'claude'])
    expect(targets).toHaveLength(2)
    expect(readFileSync(join(home, '.agents', 'skills', 'pdf', 'scripts', 'run.py'), 'utf8')).toBe('print(1)')
    expect(() => new ExtensionsService(log, home).installFiles(skill, ['agents'])).toThrow('already exists')
  })

  it('refuses sources that are not GitHub repositories', async () => {
    await expect(new StoreService((async () => new Response('{}')) as unknown as typeof fetch).downloadSkill('open.feishu.cn', 'lark')).rejects.toThrow('GitHub')
  })
})

describe('top skills', () => {
  it("reads skills.sh's leaderboard from its page data, most installed first, once each", () => {
    const entry = (source: string, skillId: string, installs: number): string => `{\\"source\\":\\"${source}\\",\\"skillId\\":\\"${skillId}\\",\\"name\\":\\"${skillId}\\",\\"installs\\":${installs},\\"weeklyInstalls\\":[1]}`
    const html = `<script>self.__next_f.push([1,"[${entry('acme/skills', 'tdd', 50)},${entry('acme/skills', 'find', 90)},${entry('acme/skills', 'tdd', 50)},${entry('docs.acme.dev', 'docs', 70)}]"])</script>`
    const top = parseLeaderboard(html)
    expect(top.map((s) => s.id)).toEqual(['acme/skills/find', 'docs.acme.dev/docs', 'acme/skills/tdd'])
    expect(top.find((s) => s.source === 'docs.acme.dev')?.installable).toBe(false)
    expect(parseLeaderboard('<html>redesigned</html>')).toEqual([])
  })
})

describe('MCP Registry servers', () => {
  it('maps packages and hosted endpoints, leaving out what Hiveory cannot run', () => {
    const server = serverOf({
      name: 'io.github.acme/weather',
      version: '1.2.0',
      repository: { url: 'https://github.com/acme/weather' },
      packages: [
        { registryType: 'npm', identifier: '@acme/weather', version: '1.2.0', transport: { type: 'stdio' }, environmentVariables: [{ name: 'API_KEY', isRequired: true, isSecret: true }] },
        { registryType: 'nuget', identifier: 'Acme.Weather', transport: { type: 'stdio' } }
      ],
      remotes: [
        { type: 'streamable-http', url: 'https://mcp.acme.dev/mcp', headers: [{ name: 'Authorization', isRequired: true, value: 'Bearer {key}' }] },
        { type: 'sse', url: 'https://{tenant}.acme.dev/sse' }
      ]
    })!
    expect(server.options.map((o) => o.kind)).toEqual(['package', 'remote'])
    expect(server.repository).toBe('https://github.com/acme/weather')
  })

  it('builds the command for each runner with the values filled in', () => {
    const npm: McpOption = { kind: 'package', registry: 'npm', identifier: '@acme/weather', version: '1.2.0', env: [{ name: 'API_KEY', required: true, secret: true }], runtimeArgs: [], args: [{ name: '--units', input: { name: 'units', required: false, secret: false, default: 'metric' } }] }
    expect(connectionFor({ name: 'io.github.acme/weather' }, npm, {})).toBe('Fill in API_KEY.')
    expect(connectionFor({ name: 'io.github.acme/weather', title: 'Weather' }, npm, { API_KEY: 'k' })).toEqual({
      name: 'Weather',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@acme/weather@1.2.0', '--units', 'metric'],
      env: { API_KEY: 'k' },
      headers: {}
    })
    const oci: McpOption = {
      kind: 'package',
      registry: 'oci',
      identifier: 'ghcr.io/acme/fs:2.0',
      env: [],
      runtimeArgs: [{ name: '-i' }, { name: '--rm' }, { name: '-v', value: '{host_dir}:/workspace:ro', vars: [{ name: 'host_dir', required: true, secret: false }] }],
      args: [{ value: '/workspace' }]
    }
    expect(optionInputs(oci).map((i) => i.name)).toEqual(['host_dir'])
    expect(connectionFor({ name: 'fs' }, oci, { host_dir: '/home/me/code' })).toMatchObject({ command: 'docker', args: ['run', '-i', '--rm', '-v', '/home/me/code:/workspace:ro', 'ghcr.io/acme/fs:2.0', '/workspace'] })
    const pypi: McpOption = { kind: 'package', registry: 'pypi', identifier: 'acme-fs', version: '0.1.3', env: [], runtimeArgs: [], args: [] }
    expect(connectionFor({ name: 'fs' }, pypi, {})).toMatchObject({ command: 'uvx', args: ['acme-fs==0.1.3'] })
    const remote: McpOption = { kind: 'remote', transport: 'streamable-http', url: 'https://mcp.acme.dev/mcp', headers: [{ name: 'Authorization', required: true, secret: true }] }
    expect(connectionFor({ name: 'x' }, remote, { Authorization: 'Bearer t' })).toMatchObject({ transport: 'http', url: 'https://mcp.acme.dev/mcp', headers: { Authorization: 'Bearer t' } })
  })
})
