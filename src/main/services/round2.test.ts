import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/domain'
import { BUILT_IN_ADAPTERS } from './cli/adapters'
import { codexMcpArgs, mcpServersJson, opencodeConfigJson } from './cli/adapters/mcp-injection'
import { ExtensionsService, parseCodexMcp, parseJsonc, parseSkillFrontmatter } from './extensions/extensions-service'
import { branchNameProblem, isBranchInUseError, parseStatus } from './git/git-commands'
import { parseState } from './persistence/schema'
import { resolveSpawnTarget } from './pty/spawn-target'
import { UpdateService } from './updates/update-service'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }

describe('git status and branch names', () => {
  it('parses porcelain v2 status', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a b src/a.ts',
      '2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts',
      'u UU N... 1 2 3 4 a b c conflict.ts',
      '? notes.md'
    ].join('\n')
    expect(parseStatus(out)).toEqual({ branch: 'feature/x', upstream: 'origin/feature/x', ahead: 2, behind: 1, changed: 3, untracked: 1 })
    expect(parseStatus('# branch.head (detached)').branch).toBeUndefined()
  })

  it('rejects unsafe or invalid branch names', () => {
    expect(branchNameProblem('hiveory/amber-harbor')).toBeNull()
    expect(branchNameProblem('feature/JIRA-12_fix.v2')).toBeNull()
    for (const bad of ['', ' ', '-flag', 'a..b', 'a//b', 'a/', 'a.lock', 'a@{1}', 'has space', 'semi;colon', '.hidden']) {
      expect(branchNameProblem(bad), bad).not.toBeNull()
    }
    expect(isBranchInUseError("fatal: 'main' is already checked out at 'C:/repo'")).toBe(true)
    expect(isBranchInUseError("fatal: 'x' is already used by worktree at '/w'")).toBe(true)
  })
})

describe('shell-free spawning of npm shims', () => {
  const win = process.platform === 'win32'
  it.runIf(win)('resolves an exe-backed shim', () => {
    const shim = '"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*'
    const target = resolveSpawnTarget('C:\\npm\\opencode.cmd', ['run', 'a & b'], () => shim, (f) => f.endsWith('opencode.exe'))
    expect(target).toEqual({ file: 'C:\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe', args: ['run', 'a & b'] })
  })

  it.runIf(win)('resolves a node-script shim with a local node.exe', () => {
    const shim = 'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@kilocode\\cli\\bin\\kilo" %*'
    const target = resolveSpawnTarget('C:\\npm\\kilo.cmd', ['x'], () => shim, (f) => f.endsWith('kilo') || f.endsWith('node.exe'))
    expect(target).toEqual({ file: 'C:\\npm\\node.exe', args: ['C:\\npm\\node_modules\\@kilocode\\cli\\bin\\kilo', 'x'] })
  })

  it.runIf(win)('never passes shell syntax through cmd.exe', () => {
    expect(() => resolveSpawnTarget('C:\\x\\tool.cmd', ['hello & del *'], () => '', () => false)).toThrow(/safely/)
    expect(resolveSpawnTarget('C:\\x\\tool.cmd', ['plain'], () => '', () => false).args).toEqual(['/d', '/s', '/c', 'C:\\x\\tool.cmd', 'plain'])
  })

  it('leaves real executables alone', () => {
    expect(resolveSpawnTarget('/usr/bin/claude', ['-p'])).toEqual({ file: '/usr/bin/claude', args: ['-p'] })
  })
})

describe('MCP injection per CLI', () => {
  const mcp = { url: 'http://127.0.0.1:5000/mcp/i1', token: 'secret' }
  it('builds each CLI-specific config', () => {
    expect(mcpServersJson(mcp)).toEqual({
      mcpServers: { hiveory: { type: 'http', url: mcp.url, headers: { Authorization: 'Bearer secret' } } }
    })
    expect(JSON.parse(opencodeConfigJson(mcp)).mcp.hiveory).toMatchObject({ type: 'remote', url: mcp.url, enabled: true })
    const codex = codexMcpArgs(mcp)
    expect(codex).toContain('mcp_servers.hiveory.url="http://127.0.0.1:5000/mcp/i1"')
    expect(codex.join(' ')).not.toContain('secret')
  })

  it('injects into Claude, Codex, OpenCode, Kilo and Copilot only when an endpoint is given', () => {
    const instance = { id: 'i1', projectId: 'p', workspaceId: 'w', cliId: 'x', petName: 'Milo', conversationId: 'c', hasConversation: false, autoApprove: false, createdAt: '' }
    const injecting = BUILT_IN_ADAPTERS.filter((a) => a.injectMcp).map((a) => a.id)
    expect(injecting.sort()).toEqual(['claude', 'codex', 'copilot', 'kilocode', 'opencode'])
    for (const id of injecting) {
      const adapter = BUILT_IN_ADAPTERS.find((a) => a.id === id)!
      const without = JSON.stringify(adapter.buildLaunch({ instance, cwd: '/', autoApprove: false, runtimeDir: '/rt' }))
      const withMcp = JSON.stringify(adapter.buildLaunch({ instance, cwd: '/', autoApprove: false, runtimeDir: '/rt', mcp }))
      expect(without, id).not.toContain('/mcp/i1')
      expect(withMcp.includes('/mcp/i1') || withMcp.includes('hiveory-mcp.json'), id).toBe(true)
    }
    const claude = BUILT_IN_ADAPTERS.find((a) => a.id === 'claude')!.buildLaunch({ instance, cwd: '/', autoApprove: false, runtimeDir: '/rt', mcp })
    expect(claude.args).toEqual(expect.arrayContaining(['--mcp-config', '--allowedTools', 'mcp__hiveory']))
  })
})

describe('extensions inventory', () => {
  it('parses skill frontmatter, codex toml and jsonc', () => {
    expect(parseSkillFrontmatter('---\nname: review\ndescription: "Reviews code"\n---\nbody')).toEqual({ name: 'review', description: 'Reviews code' })
    expect(parseSkillFrontmatter('no frontmatter')).toEqual({})
    expect(parseCodexMcp('[mcp_servers.docs]\ncommand = "npx"\n\n[mcp_servers."remote one"]\nurl = "https://x"\n[other]\n')).toEqual([
      { name: 'docs', target: 'npx', transport: 'stdio' },
      { name: 'remote one', target: 'https://x', transport: 'http' }
    ])
    expect(parseJsonc('{ // comment\n "a": "http://x", /* c */ "b": [1,2,], }')).toEqual({ a: 'http://x', b: [1, 2] })
  })

  it('scans skills and MCP servers from a home folder and shares skills safely', () => {
    const home = mkdtempSync(join(tmpdir(), 'hv-home-'))
    mkdirSync(join(home, '.claude', 'skills', 'review'), { recursive: true })
    writeFileSync(join(home, '.claude', 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Reviews\n---\n')
    mkdirSync(join(home, '.claude', 'skills', 'not-a-skill'), { recursive: true })
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['d'] } } }))
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(join(home, '.codex', 'config.toml'), '[mcp_servers.docs]\ncommand = "npx"\n')
    const service = new ExtensionsService(log, home)
    const inventory = service.scan()
    expect(inventory.skills.map((s) => s.name)).toEqual(['review'])
    expect(inventory.skills[0]!.visibleTo).toContain('claude')
    expect(inventory.mcpServers).toHaveLength(1)
    expect(inventory.mcpServers[0]!.configuredIn.map((c) => c.cliId).sort()).toEqual(['claude', 'codex'])
    const target = service.shareSkill(inventory.skills[0]!.path)
    expect(target).toBe(join(home, '.agents', 'skills', 'review'))
    expect(service.scan().skills.map((s) => s.source).sort()).toEqual(['~/.agents/skills', '~/.claude/skills'])
    expect(() => service.shareSkill(join(home, 'random'))).toThrow()
  })
})

describe('settings persistence', () => {
  it('fills defaults field by field and ignores junk', () => {
    expect(parseState({}).state.settings).toEqual(DEFAULT_SETTINGS)
    expect(parseState({ settings: { theme: 'silver', autoCheckUpdates: 'yes', extra: 1 } }).state.settings).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'silver'
    })
    expect(parseState({ settings: { theme: 'neon' } }).state.settings.theme).toBe('bronze')
  })

  it('rejects corrupt layouts so they are rebuilt', () => {
    const { state, rejected } = parseState({
      layouts: { w: { type: 'split', direction: 'horizontal', children: [{ type: 'pane', paneId: 'a' }, { type: 'pane', paneId: 'b' }], ratios: [1] } }
    })
    expect(state.layouts).toEqual({})
    expect(rejected).toBe(1)
  })
})

describe('update service', () => {
  it('is honest in development builds', async () => {
    const service = new UpdateService(null, log, () => undefined)
    expect(service.current()).toMatchObject({ state: 'unsupported' })
    expect(await service.check()).toMatchObject({ state: 'unsupported' })
  })

  it('follows updater events and only downloads when an update is available', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: false,
      checkForUpdates: vi.fn(async () => handlers['update-available']!({ version: '0.2.0' })),
      downloadUpdate: vi.fn(async () => handlers['update-downloaded']!({ version: '0.2.0' })),
      quitAndInstall: vi.fn(),
      on: (event: string, listener: (...args: unknown[]) => void) => {
        handlers[event] = listener
      }
    }
    const emitted: unknown[] = []
    const service = new UpdateService(updater as never, log, (_e, s) => emitted.push(s))
    expect(updater.autoDownload).toBe(false)
    service.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(await service.check()).toMatchObject({ state: 'available', version: '0.2.0' })
    expect(await service.download()).toMatchObject({ state: 'downloaded' })
    service.install()
    expect(updater.quitAndInstall).toHaveBeenCalled()
    expect(emitted.length).toBeGreaterThan(0)
  })
})
