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
import { PluginService, readConnection } from './plugin-service'
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
  it('lists unique Composio apps and opens only the Composio account page', () => {
    expect(new Set(PLUGIN_APPS.map((a) => a.id)).size).toBe(PLUGIN_APPS.length)
    for (const app of PLUGIN_APPS) expect(app.id).toMatch(/^[a-z0-9_]+$/)
    expect(isPluginHelpUrl(COMPOSIO.accountUrl)).toBe(true)
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

  it('reads what Composio says about an app', () => {
    const answer = (results: unknown) => JSON.stringify({ successful: true, data: { message: 'ok', results } })
    expect(readConnection(answer({ gmail: { status: 'ACTIVE' } }), 'gmail')).toEqual({ connected: true })
    expect(readConnection(answer({ gmail: { status: 'INITIATED', redirect_url: 'https://connect.composio.dev/link/ln_1' } }), 'gmail')).toEqual({
      connected: false,
      link: 'https://connect.composio.dev/link/ln_1'
    })
    expect(readConnection(answer({ gmail: { status: 'FAILED', error: 'Unknown toolkit' } }), 'gmail')).toEqual({ connected: false, error: 'Unknown toolkit' })
    expect(readConnection('not json', 'gmail')).toMatchObject({ connected: false, error: 'not json' })
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

describe('plugins through Composio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-plug-'))
  const store = new StateStore(join(dir, 'state.json'), log)
  const opened: string[] = []
  const service = new ConnectionService(store, new SecretBox(sealer), () => undefined)
  const composio = { gmail: 'INITIATED' }
  // Composio's MANAGE tool, answered here, so this test needs no network.
  const gateway = {
    refresh: async () => ({ tools: [{ name: 'COMPOSIO_MANAGE_CONNECTIONS', description: '', inputSchema: {} }] }),
    close: async () => undefined,
    exposedNames: () => new Map(),
    isConnecting: () => false,
    invoke: async (_c: unknown, tool: string, args: { toolkits: string[] }) => {
      const app = args.toolkits[0]!
      const status = composio[app as 'gmail'] ?? 'ACTIVE'
      return { isError: false, text: JSON.stringify({ successful: true, data: { results: { [app]: { status, ...(status === 'ACTIVE' ? {} : { redirect_url: `https://connect.composio.dev/link/${app}` }) } } } }) }
    }
  } as unknown as McpGateway
  service.attach(gateway)
  const plugins = new PluginService(service, gateway, (url) => opened.push(url))

  it('needs a sign-in, then connects apps on Composio and tells agents which ones', async () => {
    await expect(plugins.connect('gmail')).rejects.toThrow(/Sign in to Composio/)
    const account = await plugins.signIn()
    expect(account.pluginId).toBe('composio')
    expect(service.spec(service.composio()!).url).toBe(COMPOSIO.mcpUrl)
    // Not connected yet: the approval page opens; checking again does not open it twice.
    expect(await plugins.connect('gmail')).toEqual({ state: 'pending' })
    expect(opened).toEqual(['https://connect.composio.dev/link/gmail'])
    expect(await plugins.check('gmail')).toEqual({ state: 'pending' })
    expect(opened).toHaveLength(1)
    // Approved in the browser.
    composio.gmail = 'ACTIVE'
    expect(await plugins.check('gmail')).toEqual({ state: 'connected' })
    expect(await plugins.connect('github')).toEqual({ state: 'connected' })
    expect(service.list()[0]!.apps).toEqual(['github', 'gmail'])
    expect(service.appNames()[0]).toMatch(/^Composio \(connected: GitHub, Gmail; .*1,000\+ apps/)
    await expect(plugins.connect('not-an-app')).rejects.toThrow(/Unknown app/)
    await plugins.signOut()
    expect(service.list()).toEqual([])
  })
})
