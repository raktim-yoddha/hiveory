import { describe, expect, it } from 'vitest'
import { sendPush } from './push'

describe('push to phones', () => {
  it('sends only ids and a plain message, and reports tokens Expo says are gone', async () => {
    const sent: unknown[] = []
    const post = (async (_url: string, init?: RequestInit) => {
      sent.push(...JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] }))
    }) as typeof fetch
    const gone = await sendPush(['ExponentPushToken[a]', 'ExponentPushToken[b]'], { title: 'Hiveory', body: 'An agent needs you.', data: { instanceId: 'i1' } }, post)
    expect(gone).toEqual(['ExponentPushToken[b]'])
    expect(sent[0]).toMatchObject({ to: 'ExponentPushToken[a]', title: 'Hiveory', body: 'An agent needs you.', data: { instanceId: 'i1' } })
  })
})
