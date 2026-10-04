import { afterEach, describe, expect, it, vi } from 'vitest'
import { HookServer } from './hook-server'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
let server: HookServer | null = null

afterEach(() => server?.stop())

const post = (url: string, token: string, body: string) =>
  fetch(url, { method: 'POST', headers: { 'X-Hiveory-Token': token }, body })

describe('hook server', () => {
  it('accepts authorized hook callbacks with an empty response', async () => {
    const onHook = vi.fn()
    server = new HookServer(onHook, log)
    await server.start()
    const { baseUrl, token } = server.endpoint!
    const res = await post(`${baseUrl}/hooks/inst-1/Stop`, token, '{"hook_event_name":"Stop"}')
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    await vi.waitFor(() => expect(onHook).toHaveBeenCalledWith('inst-1', 'Stop', { hook_event_name: 'Stop' }))
  })

  it('rejects bad tokens, unknown routes and tolerates bad JSON', async () => {
    const onHook = vi.fn()
    server = new HookServer(onHook, log)
    await server.start()
    const { baseUrl, token } = server.endpoint!
    expect((await post(`${baseUrl}/hooks/inst-1/Stop`, 'wrong', '{}')).status).toBe(403)
    expect((await post(`${baseUrl}/elsewhere`, token, '{}')).status).toBe(404)
    expect((await post(`${baseUrl}/hooks/../../x/Stop`, token, '{}')).status).toBe(404)
    await post(`${baseUrl}/hooks/inst-2/notify`, token, 'not json')
    await vi.waitFor(() => expect(onHook).toHaveBeenCalledWith('inst-2', 'notify', null))
    expect(onHook).toHaveBeenCalledTimes(1)
  })
})
