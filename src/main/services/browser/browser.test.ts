import { describe, expect, it } from 'vitest'
import { AgentTools, type AgentToolDeps } from '../agent-tools/agent-tools'
import { handleMessage } from '../agent-tools/mcp-protocol'
import { CHAT_PROVIDERS } from '../chat/providers'
import { claudeAdapter } from '../cli/adapters/claude'
import { codexMcpArgs } from '../cli/adapters/mcp-injection'
import type { BrowserService } from './browser-service'
import { BrowserTools } from './browser-tools'
import { parseCookieFile } from './cookies'
import { parseKeys } from './keys'
import { PageError } from './page-driver'
import { PAGE_SCRIPT, pageCall } from './page-script'
import { fitScale, isLoadable, normalizeUrl } from './urls'

describe('isLoadable', () => {
  it('lets pages reach web, file and blank pages only', () => {
    for (const ok of ['https://a.dev/x', 'http://localhost:3000', 'file:///C:/site/index.html', 'about:blank']) expect(isLoadable(ok)).toBe(true)
    for (const bad of ['chrome://settings', 'ms-settings:privacy', 'javascript:alert(1)', 'data:text/html,x', 'vscode://file/x']) expect(isLoadable(bad)).toBe(false)
  })
})

describe('normalizeUrl', () => {
  it('adds schemes: http for local dev servers, https for hosts', () => {
    expect(normalizeUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(normalizeUrl('127.0.0.1:3000/app')).toBe('http://127.0.0.1:3000/app')
    expect(normalizeUrl('example.com/docs')).toBe('https://example.com/docs')
    expect(normalizeUrl('https://x.dev')).toBe('https://x.dev')
    expect(normalizeUrl('')).toBe('about:blank')
  })

  it('turns free text into a search and refuses dangerous schemes', () => {
    expect(normalizeUrl('how to center a div')).toMatch(/^https:\/\/www\.google\.com\/search\?q=how%20to/)
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow(/Only http/)
    expect(() => normalizeUrl('chrome://settings')).toThrow(/Only http/)
    expect(normalizeUrl('file:///C:/a.html')).toBe('file:///C:/a.html')
  })
})

describe('fitScale', () => {
  it('shrinks an emulated screen to fit the panel, never enlarges', () => {
    expect(fitScale({ width: 1920, height: 1080 }, { width: 480, height: 800 })).toBe(0.25)
    expect(fitScale({ width: 375, height: 667 }, { width: 800, height: 900 })).toBe(1)
  })
})

describe('parseKeys', () => {
  it('parses chords, aliases and sequences', () => {
    const [ctrlA] = parseKeys('Control+a')
    expect(ctrlA!.modifiers).toBe(2)
    expect(ctrlA!.keys[0]).toMatchObject({ key: 'a', code: 'KeyA', keyCode: 65 })
    expect(parseKeys('Shift+a')[0]!.keys[0]).toMatchObject({ key: 'A', text: 'A' })
    expect(parseKeys('ArrowDown ArrowDown enter').map((c) => c.keys[0]!.key)).toEqual(['ArrowDown', 'ArrowDown', 'Enter'])
    expect(parseKeys('Ctrl+Shift+Tab')[0]).toMatchObject({ modifiers: 10, keys: [{ key: 'Tab' }] })
    expect(parseKeys('Control++')[0]!.keys[0]!.key).toBe('+')
  })

  it('explains unknown keys', () => {
    expect(() => parseKeys('Hyper')).toThrow(/Unknown key "Hyper"/)
    expect(() => parseKeys('')).toThrow(/No keys/)
  })
})

describe('parseCookieFile', () => {
  it('reads Cookie-Editor JSON, keeping host-only cookies host-only', () => {
    const cookies = parseCookieFile(
      JSON.stringify([
        { name: 'sid', value: 'abc', domain: '.github.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 2000000000 },
        { name: 'h', value: '1', domain: 'app.test', hostOnly: true, path: '/x' }
      ])
    )
    expect(cookies[0]).toMatchObject({ url: 'https://github.com/', domain: '.github.com', sameSite: 'lax', expirationDate: 2000000000, httpOnly: true })
    expect(cookies[1]).toMatchObject({ url: 'http://app.test/x', name: 'h' })
    expect(cookies[1]).not.toHaveProperty('domain')
  })

  it('reads Playwright storageState and Netscape cookies.txt', () => {
    expect(parseCookieFile(JSON.stringify({ cookies: [{ name: 'a', value: 'b', domain: 'x.dev', path: '/', expires: -1, sameSite: 'None' }] }))[0]).toMatchObject({
      name: 'a',
      sameSite: 'no_restriction'
    })
    const txt = '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t1999999999\ttoken\tv=1\n#HttpOnly_shop.test\tFALSE\t/\tFALSE\t0\tcart\t42\n'
    const [a, b] = parseCookieFile(txt)
    expect(a).toMatchObject({ url: 'https://example.com/', domain: '.example.com', name: 'token', value: 'v=1', expirationDate: 1999999999 })
    expect(b).toMatchObject({ name: 'cart', httpOnly: true, url: 'http://shop.test/' })
    expect(b).not.toHaveProperty('domain')
    expect(b).not.toHaveProperty('expirationDate')
  })
})

describe('page script', () => {
  it('is self-contained JavaScript that parses', () => {
    expect(() => new Function(`return ${PAGE_SCRIPT}`)).not.toThrow()
    expect(() => new Function(`return ${pageCall('snapshot(false, 1000)')}`)).not.toThrow()
  })
})

describe('BrowserTools', () => {
  const setup = () => {
    const calls: string[] = []
    const driver = {
      navigate: async (url: string) => void calls.push(`navigate ${url}`),
      click: async (target: string) => {
        if (target === '@9') throw new PageError('Ref @9 is gone — the page changed. Take a new browser_snapshot.')
        calls.push(`click ${target}`)
        return `Clicked ${target}.`
      },
      fill: async (target: string, text: string) => {
        calls.push(`fill ${target}=${text}`)
        return `Filled ${target}.`
      },
      snapshot: async () => 'Page: Demo\n- button "Go" [@1]'
    }
    const page = { id: 'b1', driver, console: [], network: [] }
    const service = { agentPage: () => page, newAgentPage: () => page, endActivity: () => undefined } as unknown as BrowserService
    return { tools: new BrowserTools(service, '/tmp/shots', () => []), calls }
  }
  const agent = { id: 'a1', workspaceId: 'w1', petName: 'Milo' }

  it('runs a batch in order, stops at the first failure, and still returns a snapshot', async () => {
    const { tools, calls } = setup()
    const r = await tools.call(agent, 'browser_batch', {
      steps: [
        { action: 'fill', target: '@2', text: 'ada' },
        { action: 'click', target: '@9' },
        { action: 'click', target: '@1' }
      ]
    })
    expect(calls).toEqual(['fill @2=ada'])
    expect(r.isError).toBe(true)
    expect(r.text).toContain('1. ✓ Filled @2.')
    expect(r.text).toContain('2. ✗ click: Ref @9 is gone')
    expect(r.text).toContain('(stopped; 1 step(s) not run)')
    expect(r.text).toContain('- button "Go" [@1]')
  })

  it('rejects unknown batch actions and reports page errors as tool errors', async () => {
    const { tools } = setup()
    expect((await tools.call(agent, 'browser_batch', { steps: [{ action: 'teleport' }] })).text).toMatch(/unknown action "teleport"/)
    const r = await tools.call(agent, 'browser_click', { target: '@9' })
    expect(r).toMatchObject({ isError: true })
    expect(r.text).toMatch(/Take a new browser_snapshot/)
  })

  it('actions return a fresh snapshot unless asked not to', async () => {
    const { tools } = setup()
    expect((await tools.call(agent, 'browser_click', { target: '@1' })).text).toContain('Page: Demo')
    expect((await tools.call(agent, 'browser_click', { target: '@1', snapshot: false })).text).toBe('[page b1] Clicked @1.')
  })

  it('is served through AgentTools only when browser use is on, with image results', async () => {
    const { tools } = setup()
    let enabled = true
    const deps = {
      agents: { find: () => ({ id: 'a1', workspaceId: 'w1', petName: 'Milo' }) },
      registry: { list: () => [] },
      browser: () => (enabled ? tools : null)
    } as unknown as AgentToolDeps
    const host = new AgentTools(deps, 'a1')
    expect(host.list().some((t) => t.name === 'browser_batch')).toBe(true)
    expect((await host.call('browser_click', { target: '@1', snapshot: false })).text).toBe('[page b1] Clicked @1.')
    enabled = false
    expect(host.list().some((t) => t.name.startsWith('browser_'))).toBe(false)
    const imageHost = { list: () => [{ name: 'shot', description: '', inputSchema: {} }], call: async () => ({ text: 'ok', image: { data: 'AAAA', mimeType: 'image/png' } }) }
    expect(await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shot' } }, imageHost)).toMatchObject({
      result: { content: [{ type: 'text', text: 'ok' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] }
    })
  })
})

describe('routing website requests to the browser', () => {
  const endpoint = { url: 'http://127.0.0.1:1/mcp/a1', token: 't0k', browser: true }

  it('tells Claude Code agents to browse with Hiveory and takes away WebFetch', () => {
    const args = claudeAdapter.buildLaunch({ instance: { conversationId: 'c1' }, autoApprove: false, mcp: endpoint, runtimeDir: '/rt' } as never).args
    const prompt = args[args.indexOf('--append-system-prompt') + 1]!
    expect(prompt).toMatch(/list_agents/)
    expect(prompt).toMatch(/browser_navigate/)
    expect(prompt).toMatch(/NOT WebFetch/)
    expect(args.slice(args.indexOf('--disallowedTools'), args.indexOf('--disallowedTools') + 2)).toEqual(['--disallowedTools', 'WebFetch'])
    const off = claudeAdapter.buildLaunch({ instance: { conversationId: 'c1' }, autoApprove: false, mcp: { ...endpoint, browser: false }, runtimeDir: '/rt' } as never).args
    expect(off).not.toContain('--disallowedTools')
    expect(off.join(' ')).not.toMatch(/browser_navigate/)
  })

  it('gives Codex the same instructions, token off the command line', () => {
    const args = codexMcpArgs(endpoint)
    expect(args.find((a) => a.startsWith('developer_instructions='))).toMatch(/browser_navigate/)
    expect(args.join(' ')).not.toContain('t0k')
    expect(args).toContain('features.browser_use=false')
    expect(codexMcpArgs({ ...endpoint, browser: false })).not.toContain('features.browser_use=false')
  })

  it('chat runs load the MCP server too; plain chats get only the browser prompt', () => {
    const mcp = { endpoint, configPath: '/rt/chat-mcp.json', coordination: false }
    const claude = CHAT_PROVIDERS.claude!.run({ prompt: 'Check out https://x.dev', autoApprove: false, mcp })
    expect(claude.files?.[0]).toMatchObject({ path: '/rt/chat-mcp.json' })
    expect(claude.args).toContain('--mcp-config')
    const prompt = claude.args[claude.args.indexOf('--append-system-prompt') + 1]!
    expect(prompt).toMatch(/browser_navigate/)
    expect(prompt).not.toMatch(/list_agents/)
    const codex = CHAT_PROVIDERS.codex!.run({ prompt: 'x', autoApprove: false, mcp })
    expect(codex.env).toEqual({ HIVEORY_MCP_TOKEN: 't0k' })
    expect(CHAT_PROVIDERS.opencode!.run({ prompt: 'x', autoApprove: false, mcp }).env?.OPENCODE_CONFIG_CONTENT).toContain('/mcp/a1')
    expect(CHAT_PROVIDERS.claude!.run({ prompt: 'x', autoApprove: false }).args).not.toContain('--mcp-config')
  })
})
