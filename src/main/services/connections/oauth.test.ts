import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { StateStore } from '../persistence/state-store'
import { ConnectionService } from './connection-service'
import type { McpGateway } from './mcp-gateway'
import { ConnectionOAuth } from './oauth'
import { SecretBox, type Sealer } from './secret-box'

// The SDK's auth(): first call sends the browser to the provider, second exchanges the code.
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: vi.fn(async (provider: OAuthClientProvider, options: { authorizationCode?: string }) => {
    if (options.authorizationCode) {
      await provider.saveTokens({ access_token: `access-for-${options.authorizationCode}`, refresh_token: 'refresh-123456', token_type: 'Bearer' })
      return 'AUTHORIZED'
    }
    await provider.saveClientInformation?.({ client_id: 'client-1', redirect_uris: [String(provider.redirectUrl)] })
    const state = await provider.state?.()
    await provider.redirectToAuthorization(new URL(`https://login.example/authorize?state=${state}`))
    return 'REDIRECT'
  })
}))

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const sealer: Sealer = {
  isEncryptionAvailable: () => true,
  encryptString: (v) => Buffer.from([...Buffer.from(v)].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString()
}

/** Plays the browser: answers the loopback page with the given state. */
const browser = (answer: (authorizeUrl: URL) => string) =>
  vi.fn((url: string) => {
    void fetch(answer(new URL(url)))
  })

describe('sign-in plugins (ADR 0023)', () => {
  const setup = (openBrowser: (url: string) => void) => {
    const store = new StateStore(join(mkdtempSync(join(tmpdir(), 'hv-oauth-')), 'state.json'), log)
    const service = new ConnectionService(store, new SecretBox(sealer), () => undefined, openBrowser)
    service.attach({ refresh: async () => ({ tools: [] }), close: async () => undefined, exposedNames: () => new Map(), isConnecting: () => false } as unknown as McpGateway)
    return { store, service }
  }

  it('signs in through the browser and the loopback page, then keeps the tokens sealed and out of views', async () => {
    const ref: { oauth?: ConnectionOAuth } = {}
    const open = browser((authorize) => `${ref.oauth!.redirectUrl}?code=abc&state=${authorize.searchParams.get('state')}`)
    const { store, service } = setup(open)
    const view = await service.signInComposio()
    const oauth = (ref.oauth = service.spec(store.state.connections.find((c) => c.id === view.id)!).oauth!)
    expect(oauth.signedIn).toBe(false)

    await oauth.signIn(new URL('https://connect.composio.dev/mcp'))
    expect(open).toHaveBeenCalledOnce()
    expect(oauth.signedIn).toBe(true)

    // Sealed in the state file, readable by a fresh spec, never in a view.
    const saved = store.state.connections.find((c) => c.id === view.id)!
    expect(saved.oauth).toMatch(/^v1:/)
    expect(JSON.stringify(store.state.connections)).not.toContain('access-for-abc')
    expect(service.spec(saved).oauth!.signedIn).toBe(true)
    expect(service.spec(saved).oauth!.secrets).toEqual(['access-for-abc', 'refresh-123456'])
    expect(JSON.stringify(service.list())).not.toContain('access-for-abc')
  })

  it('rejects a loopback answer whose state does not match', async () => {
    const ref: { oauth?: ConnectionOAuth } = {}
    const { store, service } = setup(browser(() => `${ref.oauth!.redirectUrl}?code=abc&state=forged`))
    const view = await service.signInComposio()
    const oauth = (ref.oauth = service.spec(store.state.connections.find((c) => c.id === view.id)!).oauth!)
    await expect(oauth.signIn(new URL('https://connect.composio.dev/mcp'))).rejects.toThrow(/did not finish/)
    expect(oauth.signedIn).toBe(false)
  })

  it('never opens the browser outside a sign-in, and only for https', () => {
    const open = vi.fn()
    const oauth = new ConnectionOAuth({}, () => undefined, open, 'Composio')
    expect(() => oauth.redirectToAuthorization(new URL('https://login.example/authorize'))).toThrow(/sign in again/)
    expect(open).not.toHaveBeenCalled()
  })

  it('forgets everything when the server says the credentials are gone', () => {
    const persist = vi.fn()
    const oauth = new ConnectionOAuth({ client: { client_id: 'c' }, tokens: { access_token: 'a', token_type: 'Bearer' } }, persist, () => undefined, 'Composio')
    oauth.invalidateCredentials('tokens')
    expect(oauth.signedIn).toBe(false)
    expect(oauth.clientInformation()).toEqual({ client_id: 'c' })
    oauth.invalidateCredentials('all')
    expect(persist).toHaveBeenLastCalledWith({})
  })
})
