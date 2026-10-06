import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CHANNELS } from '@shared/ipc/contract'
import { CLIENT_LOCAL_CHANNELS, REMOTE_CHANNELS } from '@shared/ipc/remote'
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
const start = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-server-'))
  server = await startServer({ port: 0, host: '127.0.0.1', handlers, log, devicesFile: join(dir, 'devices.json'), version: '0.0.0' })
  const base = `http://127.0.0.1:${server.port}`
  const pair = async (code = server!.pairingCode()) => fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'Test' }) })
  const call = async (token: string, channel: string, payload?: unknown) =>
    (await fetch(`${base}/call`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ channel, payload }) })).json()
  return { base, dir, pair, call }
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
