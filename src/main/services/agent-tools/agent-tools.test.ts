import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliInstance, CliRuntimeDetails } from '@shared/domain'
import { ChatService } from '../chat/chat-service'
import { HookServer } from '../cli/hooks/hook-server'
import { AgentTools, type AgentToolDeps } from './agent-tools'
import { handleBody, handleMessage, SUPPORTED_PROTOCOLS, type ToolHost } from './mcp-protocol'

const agent = (id: string, petName: string, workspaceId = 'w1', cliId = 'claude'): CliInstance => ({
  id,
  petName,
  workspaceId,
  cliId,
  projectId: 'p1',
  conversationId: 'c',
  hasConversation: false,
  autoApprove: false,
  createdAt: ''
})

const setup = (runtimeOverrides: Record<string, CliRuntimeDetails> = {}) => {
  const agents = [agent('a1', 'Milo'), agent('a2', 'Luna', 'w1', 'codex'), agent('a3', 'Kai', 'w2'), { ...agent('a4', 'Ivy', 'w1', 'opencode'), chatUi: true }]
  const writes: Array<[string, string]> = []
  const runtimeDetails = (id: string): CliRuntimeDetails => runtimeOverrides[id] ?? { status: 'idle', running: true }
  const deps = {
    agents: {
      find: (id: string) => agents.find((a) => a.id === id),
      details: (a: CliInstance) => runtimeDetails(a.id),
      instancesInProject: () => agents,
      open: vi.fn((workspaceId: string, cliId: string) => ({ agent: { ...agent('a9', 'Nova', workspaceId, cliId), runtime: { status: 'idle', running: true } }, layout: null })),
      close: vi.fn(),
      paneIds: () => ['a1', 'a2']
    },
    runtime: {
      details: runtimeDetails,
      screenText: (id: string) => (id === 'a2' ? 'codex says hi' : ''),
      write: (id: string, data: string) => writes.push([id, data]),
      bracketedPaste: (id: string) => id === 'a2'
    },
    layouts: { apply: vi.fn() },
    workspaces: {
      find: (id: string) => ({ id, name: id === 'w1' ? 'Main' : 'Amber' }),
      get: (id: string) => ({ id, name: 'Main', path: '/repo' }),
      project: () => ({ id: 'p1', name: 'demo' })
    },
    registry: {
      list: () => [
        { id: 'claude', displayName: 'Claude Code', available: true },
        { id: 'codex', displayName: 'Codex', available: true },
        { id: 'gemini', displayName: 'Gemini CLI', available: false }
      ],
      displayName: (id: string) => ({ claude: 'Claude Code', codex: 'Codex' })[id] ?? id
    },
    shells: { open: vi.fn(() => ({ id: 'shell-w1', cwd: '/repo' })), has: () => false, write: vi.fn(), screenText: () => '' },
    chats: {
      isRunning: () => false,
      send: vi.fn(),
      // The real extraction, over this stub's messages.
      lastReply(this: Pick<ChatService, 'get'>, id: string) {
        return ChatService.prototype.lastReply.call(this as ChatService, id)
      },
      get: () => ({
        messages: [
          { role: 'user', parts: [{ kind: 'text', text: 'hello ivy' }] },
          { role: 'assistant', parts: [{ kind: 'text', text: 'hi from chat' }] }
        ]
      })
    }
  }
  return { tools: new AgentTools(deps as unknown as AgentToolDeps, 'a1'), deps, writes }
}

describe('agent tools', () => {
  it('lists workspace agents with status and marks the caller', async () => {
    const { tools } = setup({ a2: { status: 'waiting-for-you', running: true, waitingReason: 'permission' } })
    const { text } = await tools.call('list_agents', {})
    expect(text).toContain('Workspace "demo" has 4 agent(s)')
    expect(text).toContain('Milo — Claude Code · worktree "Main" · idle · this is you')
    expect(text).toContain('Luna — Codex · worktree "Main" · waiting-for-you (permission)')
  })

  it('exposes only installed CLIs as open_agent choices', () => {
    const { tools } = setup()
    const open = tools.list().find((t) => t.name === 'open_agent')!
    expect((open.inputSchema.properties as Record<string, { enum?: string[] }>).cli!.enum).toEqual(['claude', 'codex'])
  })

  it('names valid agents when a name is wrong (no guessing)', async () => {
    const { tools } = setup()
    const result = await tools.call('read_agent', { agent: 'Lunaa' })
    expect(result.isError).toBe(true)
    expect(result.text).toBe('No agent named "Lunaa". Agents in this workspace: Milo, Luna, Kai, Ivy.')
  })

  it('reads another agent case-insensitively', async () => {
    const { tools } = setup()
    expect((await tools.call('read_agent', { agent: 'luna' })).text).toContain('codex says hi')
  })

  it('sends messages with bracketed paste when supported and submits', async () => {
    const { tools, writes } = setup()
    await tools.call('send_message', { agent: 'Luna', message: 'line1\nline2' })
    expect(writes).toEqual([
      ['a2', '\x1b[200~line1\nline2\x1b[201~'],
      ['a2', '\r']
    ])
  })

  it('flattens newlines when bracketed paste is off, and can skip submit', async () => {
    const { tools, writes } = setup()
    await tools.call('send_message', { agent: 'Kai', message: 'a\nb', submit: false })
    expect(writes).toEqual([['a3', 'a b']])
  })

  it('refuses self-targeting and stopped agents', async () => {
    const { tools } = setup({ a2: { status: 'idle', running: false } })
    expect((await tools.call('send_message', { agent: 'Milo', message: 'x' })).text).toMatch(/yourself/)
    expect((await tools.call('close_agent', { agent: 'milo' })).text).toMatch(/yourself/)
    expect((await tools.call('send_message', { agent: 'Luna', message: 'x' })).text).toMatch(/not running/)
  })

  it('opens agents beside a named agent and validates the CLI', async () => {
    const { tools, deps } = setup()
    expect((await tools.call('open_agent', { cli: 'codex', beside: 'Kai', side: 'bottom' })).text).toBe('Opened Nova (Codex) below Kai.')
    expect(deps.agents.open).toHaveBeenCalledWith('w2', 'codex', { targetPaneId: 'a3', side: 'bottom' })
    expect((await tools.call('open_agent', { cli: 'gemini' })).text).toBe('"gemini" is not an installed CLI. Installed: claude, codex.')
  })

  it('arranges panes in the caller worktree and rejects other worktrees', async () => {
    const { tools, deps } = setup()
    await tools.call('arrange_panes', { mode: 'focus', focus: 'Luna' })
    expect(deps.layouts.apply).toHaveBeenCalledWith('w1', ['a1', 'a2'], { type: 'arrange', mode: 'focus', focusPaneId: 'a2' })
    expect((await tools.call('arrange_panes', { mode: 'focus', focus: 'Kai' })).text).toMatch(/another worktree/)
    expect((await tools.call('arrange_panes', { mode: 'spiral' })).text).toMatch(/equal, focus, columns/)
  })

  it('reports missing arguments clearly', async () => {
    const { tools } = setup()
    expect((await tools.call('send_message', { agent: 'Luna' })).text).toBe('Missing required argument "message".')
  })
})

describe('MCP protocol', () => {
  const host: ToolHost = {
    list: () => [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }],
    call: async (_n, args) => ({ text: String(args.text) })
  }

  it('initializes with the requested protocol and instructions', async () => {
    const reply = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, host)) as {
      result: { protocolVersion: string; instructions: string }
    }
    expect(reply.result.protocolVersion).toBe('2025-03-26')
    expect(reply.result.instructions).toMatch(/list_agents/)
    const fallback = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999' } }, host)) as {
      result: { protocolVersion: string }
    }
    expect(fallback.result.protocolVersion).toBe(SUPPORTED_PROTOCOLS[0])
  })

  it('lists and calls tools; unknown tools and methods are errors; notifications get no reply', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, host)).toMatchObject({ result: { tools: [{ name: 'echo' }] } })
    expect(await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } }, host)).toMatchObject({
      result: { content: [{ type: 'text', text: 'hi' }], isError: false }
    })
    expect(await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }, host)).toMatchObject({ error: { code: -32602 } })
    expect(await handleMessage({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, host)).toMatchObject({ error: { code: -32601 } })
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, host)).toBeNull()
    expect(await handleMessage({ nonsense: true }, host)).toMatchObject({ error: { code: -32600 } })
  })

  it('handles batches', async () => {
    const replies = (await handleBody(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' }
      ],
      host
    )) as unknown[]
    expect(replies).toHaveLength(1)
  })
})

describe('MCP HTTP endpoint', () => {
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
  let server: HookServer | null = null
  afterEach(() => server?.stop())

  it('requires the bearer token, refuses browsers, and speaks JSON-RPC', async () => {
    server = new HookServer(() => undefined, log)
    server.setMcpHandler(async (id, body) => handleBody(body, { list: () => [], call: async () => ({ text: id }) }))
    await server.start()
    const { baseUrl, token } = server.endpoint!
    const url = `${baseUrl}/mcp/agent-1`
    const post = (headers: Record<string, string>, body: unknown) =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    expect((await post({}, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    expect((await post({ Authorization: `Bearer ${token}`, Origin: 'https://evil.test' }, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(403)
    const ok = await post({ Authorization: `Bearer ${token}` }, { jsonrpc: '2.0', id: 7, method: 'ping' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ jsonrpc: '2.0', id: 7, result: {} })
    expect((await post({ Authorization: `Bearer ${token}` }, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    expect((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(405)
    const bad = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{oops' })
    expect(bad.status).toBe(400)
  })

  it('reads and messages chat-view agents through their chat, not a terminal', async () => {
    const { tools, deps, writes } = setup()
    expect((await tools.call('read_agent', { agent: 'Ivy' })).text).toContain('Agent: hi from chat')
    expect((await tools.call('send_message', { agent: 'ivy', message: 'run the tests' })).text).toBe('Sent to Ivy and submitted.')
    expect(deps.chats.send).toHaveBeenCalledWith('a4', 'run the tests')
    expect(writes).toEqual([])
  })
})

describe('fast orchestration', () => {
  it('run_tools runs several calls in one round trip and refuses nesting', async () => {
    const { tools } = setup()
    const r = await tools.call('run_tools', {
      calls: [{ tool: 'list_agents' }, { tool: 'read_agent', args: { agent: 'Luna' } }, { tool: 'run_tools', args: {} }]
    })
    expect(r.text).toContain('### 1. list_agents')
    expect(r.text).toContain('codex says hi')
    expect(r.text).toContain('### 3. run_tools — failed')
    expect(r.isError).toBe(true)
  })

  it('ask_agent sends, waits for the turn to end and returns the reply in one call', async () => {
    const { tools, deps } = setup()
    let n = 0
    deps.agents.details = () => (n++ < 2 ? { status: 'working', running: true } : { status: 'idle', running: true })
    const r = await tools.call('ask_agent', { agent: 'Ivy', message: 'summarise the diff' })
    expect(deps.chats.send).toHaveBeenCalledWith('a4', 'summarise the diff')
    expect(r.text).toContain('It finished.')
    expect(r.text).toContain('hi from chat')
  })
})
