import { describe, expect, it } from 'vitest'
import type { CliInstance } from '@shared/domain'
import { requestSchemas } from '@shared/ipc/contract'
import { isTrustedSenderUrl } from '../ipc/trust'
import { curlHookCommand } from './cli/adapters/types'
import { claudeAdapter } from './cli/adapters/claude'
import { findExecutable } from './cli/discovery'
import { NOT_RUNNING } from './cli/status/status-machine'
import { gitArgs, isDirtyWorktreeError, parseWorktreeList, stripRemote } from './git/git-commands'
import { buildBoard } from './kanban/build-board'
import { parseState } from './persistence/schema'
import { BUILT_IN_ADAPTERS } from './cli/adapters'
import { defineCli } from './cli/adapters/catalog'
import { sanitizeEnv } from './cli/runtime/env'

const instance = (id: string, projectId: string, workspaceId = 'w1'): CliInstance => ({
  id,
  projectId,
  workspaceId,
  cliId: 'claude',
  petName: id,
  conversationId: 'c',
  hasConversation: false,
  autoApprove: false,
  createdAt: ''
})

describe('kanban scope', () => {
  it('only shows the selected project and groups by status', () => {
    const runtime = (id: string) =>
      id === 'b' ? { status: 'working' as const, running: true } : id === 'c' ? { status: 'waiting-for-you' as const, running: true, waitingReason: 'permission' as const } : NOT_RUNNING
    const board = buildBoard('p1', [instance('a', 'p1'), instance('b', 'p1'), instance('c', 'p1'), instance('x', 'p2')], () => 'Main', runtime)
    expect(board.idle.map((c) => c.instanceId)).toEqual(['a'])
    expect(board.working.map((c) => c.instanceId)).toEqual(['b'])
    expect(board['waiting-for-you'].map((c) => c.instanceId)).toEqual(['c'])
    expect(Object.keys(board)).toEqual(['idle', 'working', 'waiting-for-you'])
  })

  it('drops instances whose workspace no longer exists', () => {
    const board = buildBoard('p1', [instance('a', 'p1', 'gone')], () => undefined, () => NOT_RUNNING)
    expect(board.idle).toHaveLength(0)
  })
})

describe('git command construction', () => {
  it('builds worktree commands without shell interpolation', () => {
    expect(gitArgs.worktreeAdd('C:/w/amber', 'hiveory/amber', 'main')).toEqual([
      'worktree', 'add', '-b', 'hiveory/amber', 'C:/w/amber', 'main'
    ])
    expect(gitArgs.worktreeRemove('/w', true)).toEqual(['worktree', 'remove', '--force', '/w'])
    expect(gitArgs.worktreeRemove('/w', false)).toEqual(['worktree', 'remove', '/w'])
    expect(gitArgs.deleteMergedBranch('hiveory/x')).toEqual(['branch', '-d', 'hiveory/x'])
  })

  it('parses porcelain worktree lists', () => {
    const out = 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /w/one\nHEAD def\nbranch refs/heads/hiveory/one\n\nworktree /w/two\nHEAD 123\ndetached\n'
    expect(parseWorktreeList(out)).toEqual([
      { path: '/repo', head: 'abc', branch: 'main', detached: false, bare: false },
      { path: '/w/one', head: 'def', branch: 'hiveory/one', detached: false, bare: false },
      { path: '/w/two', head: '123', detached: true, bare: false }
    ])
  })

  it('recognizes errors and remotes', () => {
    expect(stripRemote('origin/main')).toBe('main')
    expect(isDirtyWorktreeError("fatal: '/w' contains modified or untracked files, use --force to delete it")).toBe(true)
  })
})

describe('IPC validation', () => {
  it('trusts only the app renderer', () => {
    expect(isTrustedSenderUrl('http://localhost:5173/', 'http://localhost:5173', '/x')).toBe(true)
    expect(isTrustedSenderUrl('http://evil.test/', 'http://localhost:5173', '/x')).toBe(false)
    expect(isTrustedSenderUrl('file:///C:/app/out/renderer/index.html', undefined, 'C:\\app\\out\\renderer\\index.html')).toBe(true)
    expect(isTrustedSenderUrl('file:///C:/other.html', undefined, 'C:\\app\\out\\renderer\\index.html')).toBe(false)
    expect(isTrustedSenderUrl(undefined, undefined, '/x')).toBe(false)
  })

  it('rejects malformed payloads', () => {
    expect(requestSchemas['agents.open'].safeParse({ workspaceId: 'w', cliId: 'claude' }).success).toBe(true)
    expect(requestSchemas['agents.open'].safeParse({ workspaceId: 'w; rm -rf', cliId: 'claude' }).success).toBe(false)
    expect(requestSchemas['terminal.resize'].safeParse({ instanceId: 'a', cols: 0, rows: 10 }).success).toBe(false)
    expect(requestSchemas['layout.apply'].safeParse({ workspaceId: 'w', operation: { type: 'explode' } }).success).toBe(false)
    expect(requestSchemas['workspaces.create'].safeParse({ projectId: 'p', name: '', cliSelections: [], autoApprove: false }).success).toBe(false)
  })
})

describe('CLI discovery', () => {
  it('resolves PATHEXT executables on Windows and skips extensionless shims', () => {
    const files = new Set(['C:\\npm\\opencode', 'C:\\npm\\opencode.cmd', 'C:\\bin\\claude.exe'])
    const env = { platform: 'win32' as const, path: 'C:\\bin;C:\\npm', pathExt: '.EXE;.CMD', isExecutable: (f: string) => files.has(f) }
    expect(findExecutable('opencode', env)?.toLowerCase()).toBe('c:\\npm\\opencode.cmd')
    expect(findExecutable('claude', env)?.toLowerCase()).toBe('c:\\bin\\claude.exe')
    expect(findExecutable('gemini', env)).toBeUndefined()
  })
})

describe('hook launch configuration', () => {
  const hook = { baseUrl: 'http://127.0.0.1:4000', token: 'tok' }

  it('builds a shell-agnostic curl command', () => {
    const cmd = curlHookCommand(hook, 'i1', 'Stop')
    expect(cmd).toContain('"http://127.0.0.1:4000/hooks/i1/Stop"')
    expect(cmd).toContain('"X-Hiveory-Token: tok"')
    expect(cmd).toContain('"@-"')
  })

  it('injects claude hooks via --settings and resumes known conversations', () => {
    const inst = instance('i1', 'p1')
    const fresh = claudeAdapter.buildLaunch({ instance: inst, cwd: '/r', autoApprove: true, hook, runtimeDir: '/rt/i1' })
    expect(fresh.args).toContain('--session-id')
    expect(fresh.args).toContain('--dangerously-skip-permissions')
    expect(fresh.args).toContain('--settings')
    expect(JSON.parse(fresh.files?.[0]?.content ?? '{}').hooks.Stop).toBeDefined()
    const resumed = claudeAdapter.buildLaunch({ instance: { ...inst, hasConversation: true }, cwd: '/r', autoApprove: false, runtimeDir: '/rt' })
    expect(resumed.args).toEqual(['--resume', 'c'])
  })
})

describe('state recovery', () => {
  it('drops only invalid records', () => {
    const { state, rejected } = parseState({
      projects: [
        { id: 'p', name: 'n', path: '/p', createdAt: '', updatedAt: '', lastOpenedAt: '' },
        { id: 3 }
      ],
      layouts: { w: { type: 'pane', paneId: 'a' }, bad: { type: 'split', children: [] } },
      presets: 'nonsense'
    })
    expect(state.projects).toHaveLength(1)
    expect(state.layouts).toEqual({ w: { type: 'pane', paneId: 'a' } })
    expect(state.presets).toEqual([])
    expect(rejected).toBe(2)
  })
})

describe('agent environment', () => {
  it('keeps normal environments intact', () => {
    const env = sanitizeEnv({ PATH: '/bin', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '1', ELECTRON_RUN_AS_NODE: '1' })
    expect(env).toMatchObject({ PATH: '/bin', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '1', TERM: 'xterm-256color' })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('drops a host Claude session but keeps provider config', () => {
    const env = sanitizeEnv({
      PATH: '/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'x',
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
      AI_AGENT: 'claude',
      ANTHROPIC_BASE_URL: 'https://example.test'
    })
    expect(Object.keys(env).sort()).toEqual(['ANTHROPIC_BASE_URL', 'COLORTERM', 'PATH', 'TERM'])
  })

  it('applies adapter overrides, including removals', () => {
    expect(sanitizeEnv({ A: '1' }, { A: undefined, B: '2' })).toMatchObject({ B: '2' })
    expect(sanitizeEnv({ A: '1' }, { A: undefined }).A).toBeUndefined()
  })
})

describe('CLI catalog', () => {
  it('has unique ids and executables for every adapter', () => {
    const ids = BUILT_IN_ADAPTERS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(BUILT_IN_ADAPTERS.length).toBeGreaterThanOrEqual(20)
    for (const a of BUILT_IN_ADAPTERS) {
      expect(a.executables.length).toBeGreaterThan(0)
      expect(a.icon).toBeTruthy()
    }
  })

  it('builds launch args from the spec and only enables auto-approve when documented', () => {
    const cli = defineCli({
      id: 'x', displayName: 'X', icon: { kind: 'monogram', text: 'X' }, executables: ['x'],
      args: ['chat'], autoApproveArgs: ['--yolo']
    })
    const ctx = { instance: instance('i', 'p'), cwd: '/', runtimeDir: '/' }
    expect(cli.buildLaunch({ ...ctx, autoApprove: true }).args).toEqual(['chat', '--yolo'])
    expect(cli.buildLaunch({ ...ctx, autoApprove: false }).args).toEqual(['chat'])
    expect(cli.supportsAutoApprove).toBe(true)
    const plain = defineCli({ id: 'y', displayName: 'Y', icon: { kind: 'monogram', text: 'Y' }, executables: ['y'] })
    expect(plain.supportsAutoApprove).toBe(false)
  })

  it('codex uses the OpenAI mark', () => {
    expect(BUILT_IN_ADAPTERS.find((a) => a.id === 'codex')?.icon.kind).toBe('svg')
  })
})
