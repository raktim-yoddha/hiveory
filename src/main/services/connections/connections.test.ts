import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { COMPOSIO, PLUGIN_APPS, isPluginHelpUrl, DEFAULT_SETTINGS } from '@shared/domain'
import { agentPrompt } from '../cli/adapters/mcp-injection'
import { StateStore } from '../persistence/state-store'
import { parseState } from '../persistence/schema'
import { WallpaperService, type ImageCodec } from '../appearance/wallpaper-service'
import { ConnectionService, redactUrl } from './connection-service'
import { McpGateway, toolPrefix, toToolResult } from './mcp-gateway'
import { COMPOSIO_USER, PluginService } from './plugin-service'
import { SecretBox, type Sealer } from './secret-box'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }

/** Reversible stand-in for safeStorage. */
const sealer: Sealer = {
  isEncryptionAvailable: () => true,
  encryptString: (v) => Buffer.from([...Buffer.from(v)].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString()
}

/** A minimal MCP server over stdio: one `echo` tool that also reports an env var. */
const FIXTURE = `
const rl = require('readline').createInterface({ input: process.stdin })
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
rl.on('line', (line) => {
  const msg = JSON.parse(line)
  if (msg.id === undefined) return
  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'Echoes', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } })
  if (msg.method === 'tools/call') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: msg.params.arguments.text + ':' + process.env.FIXTURE_KEY + ':' + (process.env.HIVEORY_PARENT_SECRET || 'none') }] } })
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'nope' } })
})
`

describe('plugin catalog (ADR 0023)', () => {
  it('lists unique Composio apps and opens only the page where the Composio key comes from', () => {
    expect(new Set(PLUGIN_APPS.map((a) => a.id)).size).toBe(PLUGIN_APPS.length)
    for (const app of PLUGIN_APPS) expect(app.id).toMatch(/^[a-z0-9_]+$/)
    expect(isPluginHelpUrl(COMPOSIO.keyUrl)).toBe(true)
    expect(isPluginHelpUrl('https://evil.example')).toBe(false)
  })

  it('drops the old key-based plugins and their keys when the state is read', () => {
    const base = { enabled: true, transport: 'http', env: {}, headers: {}, tools: [] }
    const { state } = parseState({
      connections: [
        { ...base, id: 'c1', name: 'GitHub', pluginId: 'github', values: { token: 'v1:abc' } },
        { ...base, id: 'c2', name: 'Composio', pluginId: 'composio', apps: ['gmail'] },
        { ...base, id: 'c3', name: 'My server', url: 'https://mcp.example' }
      ]
    })
    expect(state.connections.map((c) => c.id)).toEqual(['c2', 'c3'])
    expect(state.connections[0]!.apps).toEqual(['gmail'])
    expect(JSON.stringify(state)).not.toContain('v1:abc')
  })
})

describe('secret box', () => {
  it('seals with the OS when it can, encodes otherwise, and tolerates foreign blobs', () => {
    const box = new SecretBox(sealer)
    const sealed = box.seal('sk-123')
    expect(sealed.startsWith('v1:')).toBe(true)
    expect(sealed).not.toContain('sk-123')
    expect(box.open(sealed)).toBe('sk-123')
    const plain = new SecretBox(null)
    expect(plain.encrypted).toBe(false)
    expect(plain.open(plain.seal('x'))).toBe('x')
    expect(new SecretBox({ ...sealer, decryptString: () => { throw new Error('other user') } }).open(sealed)).toBe('')
  })
})

describe('gateway helpers', () => {
  it('prefixes, flattens results and redacts URLs', () => {
    expect(toolPrefix('Jira & Confluence')).toBe('jira_confluence')
    expect(toolPrefix('!!!')).toBe('app')
    expect(toToolResult({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'AA', mimeType: 'image/png' }, { type: 'text', text: 'b' }] })).toEqual({
      text: 'a\nb',
      isError: false,
      image: { data: 'AA', mimeType: 'image/png' }
    })
    expect(toToolResult({ content: [], structuredContent: { n: 1 }, isError: true }).isError).toBe(true)
    expect(redactUrl('https://mcp.zapier.com/api/mcp/s/abcdefghijklmnopqrstuvwxyz0123456789/mcp?k=1')).toBe('https://mcp.zapier.com/api/mcp/s/…/mcp')
  })

  it('tells agents about connected apps in their prompt', () => {
    expect(agentPrompt({ url: 'u', token: 't', apps: ['GitHub', 'Notion'] })).toContain('GitHub, Notion')
    expect(agentPrompt({ url: 'u', token: 't', coordination: false })).not.toContain('list_agents')
  })
})

process.env.HIVEORY_PARENT_SECRET = 'parent-only'

describe('connections end to end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-conn-'))
  const script = join(dir, 'server.cjs')
  writeFileSync(script, FIXTURE)
  const store = new StateStore(join(dir, 'state.json'), log)
  const events: string[] = []
  const service = new ConnectionService(store, new SecretBox(sealer), (_e, p) => events.push((p as { topic: string }).topic))
  const gateway = new McpGateway(() => service.enabled(), (c) => service.spec(c), log, 'test')
  service.attach(gateway)
  afterAll(() => gateway.closeAll())

  it('adds a stdio server, caches its tools, serves calls with the sealed env, and never exposes the secret', async () => {
    const view = await service.saveCustom({ name: 'Fixture One', transport: 'stdio', command: process.execPath, args: [script], env: { FIXTURE_KEY: 's3cret' }, headers: {} })
    expect(view.state).toBe('ready')
    expect(view.tools.map((t) => t.name)).toEqual(['fixture_one_echo'])
    expect(JSON.stringify(service.list())).not.toContain('s3cret')
    expect(JSON.stringify(store.state.connections)).not.toContain('s3cret')
    expect(view.secretsSet).toEqual(['FIXTURE_KEY'])
    expect(gateway.definitions()[0]).toMatchObject({ name: 'fixture_one_echo', description: '[Fixture One] Echoes' })
    // The server got its own key (masked before agents see it) and none of Hiveory's environment.
    expect(await gateway.call({}, 'fixture_one_echo', { text: 'hi' })).toEqual({ text: 'hi:••••:none', isError: false })
    expect(events).toContain('connections')

    // Editing with an empty value keeps the stored secret.
    const edited = await service.saveCustom({ id: view.id, name: 'Fixture One', transport: 'stdio', command: process.execPath, args: [script], env: { FIXTURE_KEY: '' }, headers: {} })
    expect(edited.state).toBe('ready')
    expect(await gateway.call({}, 'fixture_one_echo', { text: 'again' })).toMatchObject({ text: 'again:••••:none' })

    // Off: tools disappear for agents.
    await service.setEnabled(view.id, false)
    expect(gateway.handles('fixture_one_echo')).toBe(false)
    await service.remove(view.id)
    expect(service.list()).toEqual([])
  }, 30_000)

  it('reports a server that cannot start as an error', async () => {
    const view = await service.saveCustom({ name: 'Broken', transport: 'stdio', command: process.execPath, args: [join(dir, 'missing.cjs')], env: {}, headers: {} })
    expect(view.state).toBe('error')
    expect(view.error).toBeTruthy()
    await service.remove(view.id)
  }, 30_000)

  it('validates a server before connecting', async () => {
    await expect(service.saveCustom({ name: 'x', transport: 'http', url: 'ftp://nope', env: {}, headers: {} })).rejects.toThrow(/http/)
  })
})

describe('wallpapers', () => {
  const codec = (width: number, empty = false): ImageCodec => ({
    createFromPath: () => ({
      isEmpty: () => empty,
      getSize: () => ({ width, height: width / 2 }),
      resize: ({ width: w }) => ({ toJPEG: () => Buffer.from(`resized-${w}`) }),
      toJPEG: () => Buffer.from('original')
    })
  })

  it('copies images in (downscaled with a thumbnail), lists, resolves and removes them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-wall-'))
    const source = join(dir, 'photo.PNG')
    writeFileSync(source, 'png-bytes')
    const service = new WallpaperService(join(dir, 'store'), codec(6000))
    const image = service.add(source)
    expect(image.file).toMatch(/^w-[a-f0-9]{12}\.jpg$/)
    expect(image.url).toBe(`hv-wallpaper://img/${image.file}`)
    expect(image.thumb).toMatch(/t-[a-f0-9]{12}\.jpg$/)
    expect(service.list().map((i) => i.file)).toEqual([image.file])
    expect(service.resolve(image.url)).toBeTruthy()
    expect(service.resolve('hv-wallpaper://img/../state.json')).toBeNull()
    expect(service.resolve('hv-wallpaper://other/' + image.file)).toBeNull()
    service.remove(image.file)
    expect(service.list()).toEqual([])
    expect(() => service.add(join(dir, 'notes.txt'))).toThrow(/Choose an image/)
  })

  it('keeps formats the codec cannot decode as they are', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-wall-'))
    const source = join(dir, 'anim.gif')
    writeFileSync(source, 'gif')
    const image = new WallpaperService(join(dir, 'store'), codec(0, true)).add(source)
    expect(image.file).toMatch(/\.gif$/)
    expect(image.thumb).toBe(image.url)
  })

  it('persists appearance settings and drops junk', () => {
    expect(parseState({ settings: { theme: 'jade', wallpaper: 'image:w-0123456789ab.jpg', surfaceOpacity: 0 } }).state.settings).toMatchObject({
      theme: 'jade',
      wallpaper: 'image:w-0123456789ab.jpg',
      surfaceOpacity: 0
    })
    expect(parseState({ settings: { wallpaper: 'preset:aurora', surfaceOpacity: 9 } }).state.settings).toMatchObject({
      wallpaper: DEFAULT_SETTINGS.wallpaper,
      surfaceOpacity: DEFAULT_SETTINGS.surfaceOpacity
    })
  })
})

describe('plugins through the user Composio key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-plug-'))
  const store = new StateStore(join(dir, 'state.json'), log)
  const service = new ConnectionService(store, new SecretBox(sealer), () => undefined)
  // A gateway that "connects" instantly, so this test needs no MCP server.
  service.attach({ refresh: async () => ({ tools: [{ name: 'COMPOSIO_SEARCH_TOOLS', description: '', inputSchema: {} }] }), close: async () => undefined, exposedNames: () => new Map(), isConnecting: () => false } as unknown as McpGateway)
  const opened: string[] = []
  // Composio's REST API: sessions, link, list and delete, for one user and project key.
  const composio = { sessions: 0, accounts: [] as Array<{ id: string; toolkit: { slug: string }; alias: string | null; status: string; state: unknown }>, seen: [] as string[] }
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/api/v3.1', '')
    composio.seen.push(`${init?.method ?? 'GET'} ${path}`)
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status })
    if ((init?.headers as Record<string, string>)['x-api-key'] !== 'ak_good_key') return json(401, { error: { message: 'Invalid API key' } })
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (path === '/tool_router/session') {
      expect(body).toMatchObject({ user_id: COMPOSIO_USER, multi_account: { enable: true } })
      return json(201, { session_id: `trs_${++composio.sessions}`, mcp: { type: 'http', url: `https://backend.composio.dev/tool_router/trs_${composio.sessions}/mcp` } })
    }
    const link = path.match(/^\/tool_router\/session\/(trs_\d+)\/link$/)
    if (link) {
      if (link[1] !== `trs_${composio.sessions}`) return json(404, { error: { message: 'Session not found' } })
      const id = `ca_${composio.accounts.length + 1}`
      composio.accounts.push({ id, toolkit: { slug: body.toolkit }, alias: body.alias ?? null, status: 'INITIATED', state: { val: { access_token: 'secret-token-123' } } })
      return json(201, { link_token: 'lt', redirect_url: `https://connect.composio.dev/link/${id}`, connected_account_id: id })
    }
    if (path === '/connected_accounts') {
      expect(url.searchParams.get('user_ids')).toBe(COMPOSIO_USER)
      return json(200, { items: composio.accounts })
    }
    const del = path.match(/^\/connected_accounts\/(ca_\d+)$/)
    if (del && init?.method === 'DELETE') {
      composio.accounts = composio.accounts.filter((a) => a.id !== del[1])
      return json(200, { success: true })
    }
    return json(404, { error: { message: 'Not found' } })
  }) as typeof fetch
  const plugins = new PluginService(service, (url) => opened.push(url), fake, 'https://backend.composio.dev/api/v3.1')

  it('saves a working key once, connects apps straight to their sign-in, holds labelled accounts and disconnects them', async () => {
    expect(await plugins.status()).toEqual({ keySet: false, accounts: [] })
    await expect(plugins.connect('gmail')).rejects.toThrow(/Composio API key first/)
    await expect(plugins.setKey('ak_bad_key')).rejects.toThrow(/did not accept this API key/)
    expect(service.composio()).toBeUndefined()

    expect(await plugins.setKey('ak_good_key')).toEqual({ keySet: true, accounts: [] })
    const saved = service.composio()!
    expect(service.spec(saved)).toMatchObject({ transport: 'http', url: 'https://backend.composio.dev/tool_router/trs_1/mcp', headers: { 'x-api-key': 'ak_good_key' } })
    expect(JSON.stringify(store.state.connections)).not.toContain('ak_good_key')
    expect(JSON.stringify(service.list())).not.toContain('ak_good_key')

    // Connect goes straight to the app's own sign-in page: no Composio login.
    expect(await plugins.connect('gmail')).toEqual({ id: 'ca_1', appId: 'gmail', status: 'pending' })
    expect(opened).toEqual(['https://connect.composio.dev/link/ca_1'])
    composio.accounts[0]!.status = 'ACTIVE'
    // A second, labelled account of the same app.
    expect(await plugins.connect('gmail', 'Work')).toMatchObject({ id: 'ca_2', label: 'Work' })
    composio.accounts[1]!.status = 'ACTIVE'
    const status = await plugins.status()
    expect(status.accounts).toEqual([
      { id: 'ca_1', appId: 'gmail', status: 'active' },
      { id: 'ca_2', appId: 'gmail', label: 'Work', status: 'active' }
    ])
    expect(JSON.stringify(status)).not.toContain('secret-token')
    expect(service.appNames()[0]).toMatch(/^Composio \(connected: Gmail; /)

    // A session deleted on Composio's side is started again.
    composio.sessions++
    expect(await plugins.connect('github')).toMatchObject({ id: 'ca_3', appId: 'github' })
    expect(service.composio()!.session).toBe(`trs_${composio.sessions}`)

    await plugins.disconnect('ca_2')
    expect(composio.accounts.map((a) => a.id)).toEqual(['ca_1', 'ca_3'])
    await expect(plugins.disconnect('ca_99')).rejects.toThrow(/no longer connected/)
    await expect(plugins.connect('not-an-app')).rejects.toThrow(/Unknown app/)

    await plugins.removeKey()
    expect(service.list()).toEqual([])
  })
})
