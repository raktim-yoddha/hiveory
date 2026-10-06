import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PLUGINS, pluginById, resolvePluginServer, isPluginHelpUrl, DEFAULT_SETTINGS } from '@shared/domain'
import { agentPrompt } from '../cli/adapters/mcp-injection'
import { StateStore } from '../persistence/state-store'
import { parseState } from '../persistence/schema'
import { WallpaperService, type ImageCodec } from '../appearance/wallpaper-service'
import { ConnectionService, redactUrl } from './connection-service'
import { McpGateway, toolPrefix, toToolResult } from './mcp-gateway'
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

describe('plugin catalog', () => {
  it('lists unique plugins with a key page, fields and a server', () => {
    expect(new Set(PLUGINS.map((p) => p.id)).size).toBe(PLUGINS.length)
    for (const plugin of PLUGINS) {
      expect(plugin.keyUrl).toMatch(/^https:\/\//)
      // A sign-in plugin has no fields: the user signs in with their own account (ADR 0023).
      expect(plugin.fields.length > 0 || plugin.auth === 'oauth').toBe(true)
      expect(isPluginHelpUrl(plugin.keyUrl)).toBe(true)
    }
    expect(isPluginHelpUrl('https://evil.example')).toBe(false)
  })

  it('fills templates and drops parts whose optional field is empty', () => {
    const sentry = pluginById('sentry')!
    expect(resolvePluginServer(sentry, { token: 'abc' })).toEqual({
      server: { transport: 'stdio', command: 'npx', args: ['-y', '@sentry/mcp-server@latest'], env: { SENTRY_ACCESS_TOKEN: 'abc' } },
      missing: []
    })
    expect(resolvePluginServer(sentry, { token: 'abc', host: 'sentry.me' }).server).toMatchObject({ args: ['-y', '@sentry/mcp-server@latest', '--host=sentry.me'] })
    // Defaults fill optional fields; required ones are reported by label.
    expect(resolvePluginServer(pluginById('gitlab')!, { token: 't' }).server).toMatchObject({ env: { GITLAB_API_URL: 'https://gitlab.com/api/v4' } })
    expect(resolvePluginServer(pluginById('slack')!, { token: 't' }).missing).toEqual(['Workspace (team) ID'])
    // Remote plugins: bearer header and optional query parameters.
    expect(resolvePluginServer(pluginById('supabase')!, { token: 'sbp', project: 'ref1' }).server).toEqual({
      transport: 'http',
      url: 'https://mcp.supabase.com/mcp?project_ref=ref1',
      headers: { Authorization: 'Bearer sbp' }
    })
    expect(resolvePluginServer(pluginById('supabase')!, { token: 'sbp' }).server).toMatchObject({ url: 'https://mcp.supabase.com/mcp' })
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

  it('validates plugin fields before connecting', async () => {
    await expect(service.savePlugin('slack', { token: 'xoxb' })).rejects.toThrow(/Workspace \(team\) ID/)
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

describe('plugin accounts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-acct-'))
  const store = new StateStore(join(dir, 'state.json'), log)
  const service = new ConnectionService(store, new SecretBox(sealer), () => undefined)
  // A gateway that "connects" instantly, so this test needs no network.
  service.attach({ refresh: async () => ({ tools: [] }), close: async () => undefined, exposedNames: () => new Map(), isConnecting: () => false } as unknown as McpGateway)

  it('keeps several named accounts of one plugin, each with its own name and key', async () => {
    const work = await service.savePlugin('github', { token: 'ghp_work_123456' })
    expect(work.name).toBe('GitHub')
    await expect(service.savePlugin('github', { token: 'ghp_other' })).rejects.toThrow(/Name this account/)
    const personal = await service.savePlugin('github', { token: 'ghp_personal_654321' }, { label: 'Personal' })
    expect(personal.name).toBe('GitHub · Personal')
    expect(personal.label).toBe('Personal')
    await expect(service.savePlugin('github', { token: 'x' }, { label: 'personal' })).rejects.toThrow(/already exists/)
    // Editing one account leaves the other's key alone.
    await service.savePlugin('github', { token: '' }, { id: work.id, label: 'Work' })
    const specs = service.all().map((c) => service.spec(c))
    expect(specs.map((s) => s.headers?.Authorization)).toEqual(['Bearer ghp_work_123456', 'Bearer ghp_personal_654321'])
    expect(service.list().map((c) => c.name)).toEqual(['GitHub · Work', 'GitHub · Personal'])
    expect(JSON.stringify(service.list())).not.toMatch(/ghp_/)
  })
})
