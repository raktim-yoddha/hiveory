import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CHANNELS } from '@shared/ipc/contract'
import { CLIENT_LOCAL_CHANNELS, MOBILE_CHANNELS, REMOTE_CHANNELS } from '@shared/ipc/remote'
import type { Handlers } from '../ipc/router'
import { startServer, type HiveoryServer } from './server'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const calls: string[] = []
/** Every handler echoes its channel; projects.list returns a value. */
const handlers = new Proxy({} as Handlers, {
  get: (_t, channel: string) => (input: unknown) => {
    calls.push(channel)
    return channel === 'projects.list' ? [{ id: 'p1' }] : input
  }
})

let server: HiveoryServer | null = null
const start = async (ownerPairing?: (address: string) => Promise<boolean>) => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-server-'))
  server = await startServer({ port: 0, hosts: ['127.0.0.1'], handlers, log, devicesFile: join(dir, 'devices.json'), version: '0.0.0', ownerPairing })
  const base = `http://127.0.0.1:${server.port}`
  /** null sends no code at all (the owner's code-less pairing). */
  const pair = async (code: string | null = server!.pairingCode()) =>
    fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: code ?? undefined, name: 'Test' }) })
  const call = async (token: string, channel: string, payload?: unknown) =>
    (await fetch(`${base}/call`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ channel, payload }) })).json()
  /** Pairs as the phone app does (ADR 0027). */
  const pairPhone = async () =>
    ((await (await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: server!.pairingCode(), name: 'Phone', client: 'mobile' }) })).json()) as { token: string }).token
  return { base, dir, pair, call, pairPhone }
}

/** Reads one event stream until `until` holds (or 2 s pass); returns what arrived. */
const readEvents = async (res: Response, until: (text: string) => boolean): Promise<string> => {
  const reader = res.body!.getReader()
  let text = ''
  const end = Date.now() + 2000
  while (!until(text) && Date.now() < end) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 200))])
    if (chunk && !chunk.done) text += new TextDecoder().decode(chunk.value)
  }
  await reader.cancel()
  return text
}

afterEach(() => {
  server?.close()
  server = null
})

describe('Hiveory server', () => {
  it('pairs once per code and keeps only a hash of the device token', async () => {
    const { pair, dir } = await start()
    const code = server!.pairingCode()
    const first = await pair(code)
    const { token } = (await first.json()) as { token: string }
    expect(first.status).toBe(200)
    expect((await pair(code)).status).toBe(403)
    expect(server!.pairingCode()).not.toBe(code)
    const stored = readFileSync(join(dir, 'devices.json'), 'utf8')
    expect(stored).not.toContain(token)
  })

  it('refuses calls without a paired token', async () => {
    const { base } = await start()
    expect((await fetch(`${base}/call`, { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await fetch(`${base}/events`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401)
  })

  it('pauses pairing after many wrong codes', async () => {
    const { pair } = await start()
    for (let i = 0; i < 10; i++) expect((await pair('ZZZZZZZZ')).status).toBe(403)
    expect((await pair()).status).toBe(429)
  })

  it('runs allowed channels, validated; refuses the rest', async () => {
    const { pair, call } = await start()
    const { token } = (await (await pair()).json()) as { token: string }
    expect(await call(token, 'projects.list')).toEqual({ ok: true, value: [{ id: 'p1' }] })
    expect(await call(token, 'projects.pickFolder', { purpose: 'project' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(await call(token, 'updates.install')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(await call(token, 'agents.close', { instanceId: '../x' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(calls).not.toContain('projects.pickFolder')
  })

  it('streams events to paired clients', async () => {
    const { base, pair } = await start()
    const { token } = (await (await pair()).json()) as { token: string }
    const res = await fetch(`${base}/events`, { headers: { authorization: `Bearer ${token}` } })
    const reader = res.body!.getReader()
    await new Promise((r) => setTimeout(r, 50))
    server!.broadcast('state.changed', { topic: 'projects' })
    let text = ''
    while (!text.includes('state.changed')) text += new TextDecoder().decode((await reader.read()).value)
    expect(text).toContain('"topic":"projects"')
    await reader.cancel()
  })

  it("pairs the owner's own devices without a code, judged from the socket address", async () => {
    const seen: string[] = []
    const { pair } = await start(async (address) => {
      seen.push(address)
      return true
    })
    expect((await pair(null)).status).toBe(200)
    expect(seen[0]).toMatch(/127\.0\.0\.1$/)
    expect(server!.devices()).toHaveLength(1)
  })

  it('asks for the code when the device is not the owner’s, or without Tailscale', async () => {
    const { pair } = await start(async () => false)
    const refused = await pair(null)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ needsCode: true })
    expect((await pair()).status).toBe(200)
    server!.close()
    const plain = await start()
    expect((await plain.pair(null)).status).toBe(403)
  })

  it('revoking a device ends its event stream and refuses its token', async () => {
    const { base, pair, call } = await start()
    const { token } = (await (await pair()).json()) as { token: string }
    const res = await fetch(`${base}/events`, { headers: { authorization: `Bearer ${token}` } })
    const reader = res.body!.getReader()
    await reader.read()
    server!.revoke(server!.devices()[0]!.id)
    for (;;) if ((await reader.read()).done) break
    expect(server!.devices()).toEqual([])
    expect(await call(token, 'projects.list')).toMatchObject({ error: 'Pair this device first.' })
  })

  it('keeps serving when an extra address cannot be opened', async () => {
    const { base } = await start()
    // 192.0.2.0/24 is reserved for documentation: no machine has it.
    await server!.setHosts(['127.0.0.1', '192.0.2.1'])
    expect((await fetch(`${base}/health`)).ok).toBe(true)
  })

  it('a phone may only use the phone channels, whatever it asks for', async () => {
    const { call, pairPhone } = await start()
    const token = await pairPhone()
    expect(server!.devices()[0]).toMatchObject({ name: 'Phone', kind: 'mobile' })
    expect(await call(token, 'projects.list')).toMatchObject({ ok: true })
    expect(await call(token, 'projects.remove', { projectId: 'p1' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(await call(token, 'settings.update', { theme: 'dark' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(await call(token, 'terminal.resize', { instanceId: 'a1', cols: 40, rows: 20 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    for (const c of MOBILE_CHANNELS) expect(REMOTE_CHANNELS.has(c)).toBe(true)
  })

  it('streams one terminal, or everything but terminals, to save a phone’s data', async () => {
    const { base, pairPhone } = await start()
    const token = await pairPhone()
    const headers = { authorization: `Bearer ${token}` }
    const quiet = await fetch(`${base}/events?terminal=none`, { headers })
    const one = await fetch(`${base}/events?terminal=a1`, { headers })
    await new Promise((r) => setTimeout(r, 50))
    server!.broadcast('terminal.data', { instanceId: 'a1', data: 'mine', offset: 0 })
    server!.broadcast('terminal.data', { instanceId: 'a2', data: 'other', offset: 0 })
    server!.broadcast('state.changed', { topic: 'agents' })
    const quietText = await readEvents(quiet, (t) => t.includes('state.changed'))
    const oneText = await readEvents(one, (t) => t.includes('mine'))
    expect(quietText).toContain('state.changed')
    expect(quietText).not.toContain('terminal.data')
    expect(oneText).toContain('"data":"mine"')
    expect(oneText).not.toContain('other')
    expect(oneText).not.toContain('state.changed')
  })

  it('keeps a phone’s push token, accepting only Expo tokens', async () => {
    const { base, pairPhone } = await start()
    const token = await pairPhone()
    const push = (body: unknown) => fetch(`${base}/push`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    expect((await push({ token: 'https://evil.example/hook' })).status).toBe(400)
    expect((await push({ token: 'ExponentPushToken[abcdefgh12345]' })).status).toBe(200)
    expect(server!.pushTokens()).toEqual(['ExponentPushToken[abcdefgh12345]'])
    server!.dropPushToken('ExponentPushToken[abcdefgh12345]')
    expect(server!.pushTokens()).toEqual([])
    expect((await fetch(`${base}/push`, { method: 'POST', body: '{}' })).status).toBe(401)
  })

  it('remote and client-local channels are real channels and never overlap', () => {
    const all = new Set(CHANNELS)
    for (const c of [...REMOTE_CHANNELS, ...CLIENT_LOCAL_CHANNELS]) expect(all.has(c)).toBe(true)
    expect([...REMOTE_CHANNELS].filter((c) => CLIENT_LOCAL_CHANNELS.has(c))).toEqual([])
    // Nothing that shows the server's screen or dialogs, or changes its install, is remote.
    for (const c of ['projects.open', 'projects.pickFolder', 'system.revealPath', 'files.reveal', 'updates.install', 'browser.show', 'chat.attachPath', 'voice.transcribe'] as const) {
      expect(REMOTE_CHANNELS.has(c)).toBe(false)
    }
  })
})
