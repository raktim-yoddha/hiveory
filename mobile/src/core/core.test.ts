import { describe, expect, it } from 'vitest'
import { pairingLink } from '@shared/domain/tailnet'
import { MOBILE_CHANNELS, REMOTE_CHANNELS } from '@shared/ipc/remote'
import { PHONE_CHANNELS } from './api/contract'
import { createEmitter } from './api/emitter'
import { staleChannels } from './api/invalidation'
import { computerName, NeedsCodeError, pairWith, parsePairingLink } from './computers/pairing'
import { createComputersStore } from './computers/store'
import { memoryStore } from './storage/secure'
import { mergeChunk } from './terminal/merge'

describe('the phone and the computer agree', () => {
  it('calls only channels the computer lets a phone use', () => {
    for (const channel of PHONE_CHANNELS) expect(MOBILE_CHANNELS.has(channel), channel).toBe(true)
    for (const channel of MOBILE_CHANNELS) expect(REMOTE_CHANNELS.has(channel), channel).toBe(true)
  })


  it('reads the pairing link the computer shows', () => {
    expect(parsePairingLink(pairingLink('devbox.tail1.ts.net', 7788, 'ABCD2345'))).toEqual({ address: 'devbox.tail1.ts.net', port: 7788, code: 'ABCD2345' })
    expect(parsePairingLink('hiveory://pair?a=100.64.0.2&p=7788')).toEqual({ address: '100.64.0.2', port: 7788 })
    expect(parsePairingLink('https://evil.example/pair?a=x&p=1')).toBeNull()
    expect(parsePairingLink('hiveory://pair?a=bad host&p=7788')).toBeNull()
    expect(computerName('devbox.tail1.ts.net')).toBe('devbox')
    expect(computerName('100.64.0.2')).toBe('100.64.0.2')
    expect(computerName('devbox.tail1.ts.net', 7790)).toBe('devbox:7790')
  })
})

/** A computer that answers /health and /pair the way the desktop's server does. */
const computer = (pair: (body: Record<string, unknown>) => { status: number; body: unknown }) =>
  (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true, app: 'hiveory' }))
    const r = pair(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as never

describe('pairing', () => {
  it('pairs as a phone, without a code on the same Tailscale account', async () => {
    const seen: Record<string, unknown>[] = []
    const result = await pairWith({ address: 'devbox.tail1.ts.net', port: 7788 }, 'Alex phone', computer((b) => (seen.push(b), { status: 200, body: { token: 't1' } })))
    expect(seen[0]).toEqual({ name: 'Alex phone', client: 'mobile' })
    expect(result).toEqual({ token: 't1', computer: { id: 'devbox.tail1.ts.net:7788', name: 'devbox', address: 'devbox.tail1.ts.net', port: 7788 } })
  })

  it('asks for the code when the computer wants one, and sends it', async () => {
    const post = computer((b) => (b.code === 'ABCD2345' ? { status: 200, body: { token: 't2' } } : { status: 403, body: { needsCode: true, error: 'needs code' } }))
    await expect(pairWith({ address: 'box', port: 7788 }, 'Phone', post)).rejects.toBeInstanceOf(NeedsCodeError)
    await expect(pairWith({ address: 'box', port: 7788, code: 'abcd2345' }, 'Phone', post)).resolves.toMatchObject({ token: 't2' })
  })

  it('says plainly when nothing answers', async () => {
    const dead = (async () => {
      throw new Error('offline')
    }) as never
    await expect(pairWith({ address: 'box', port: 7788 }, 'Phone', dead)).rejects.toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})

describe('paired computers', () => {
  it('keep their tokens in secure storage and forget a computer whose token is gone', async () => {
    const storage = memoryStore()
    const store = createComputersStore(storage)
    await store.getState().add({ id: 'a:1', name: 'a', address: 'a', port: 1 }, 'ta')
    await store.getState().add({ id: 'b:1', name: 'b', address: 'b', port: 1 }, 'tb')
    expect(store.getState().activeId).toBe('b:1')
    expect(await storage.get('hiveory.computers')).not.toContain('ta')
    const again = createComputersStore(storage)
    await again.getState().load()
    expect(again.getState().tokens).toEqual({ 'a:1': 'ta', 'b:1': 'tb' })
    await storage.remove('hiveory.token.a_1')
    const third = createComputersStore(storage)
    await third.getState().load()
    expect(third.getState().computers.map((c) => c.id)).toEqual(['b:1'])
    await third.getState().remove('b:1')
    expect(third.getState().activeId).toBeNull()
  })
})

describe('live updates', () => {
  it('refresh only what an event changed', () => {
    expect(staleChannels({ event: 'state.changed', payload: { topic: 'agents' } })).toEqual(['agents.list', 'workspaces.list', 'kanban.board'])
    expect(staleChannels({ event: 'runtime.changed', payload: {} as never })).toEqual(['agents.list', 'kanban.board'])
    expect(staleChannels({ event: 'terminal.data', payload: {} as never })).toEqual([])
  })

  it('a listener that throws never stops the others', () => {
    const emitter = createEmitter()
    const got: string[] = []
    emitter.on('state.changed', () => {
      throw new Error('boom')
    })
    emitter.on('state.changed', (p) => got.push(p.topic))
    emitter.emit({ event: 'state.changed', payload: { topic: 'projects' } })
    expect(got).toEqual(['projects'])
  })

  it('merges terminal chunks with the snapshot without repeating output', () => {
    expect(mergeChunk(10, 'abcde', 5)).toEqual({ write: '', written: 10 })
    expect(mergeChunk(10, 'abcdefgh', 6)).toEqual({ write: 'efgh', written: 14 })
    expect(mergeChunk(10, 'xy', 10)).toEqual({ write: 'xy', written: 12 })
  })
})
