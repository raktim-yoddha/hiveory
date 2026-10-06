import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

/** What a signed-in connection keeps, sealed as one JSON value on the connection. */
export interface OAuthState {
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
}

/** How long the browser has to come back from the provider's sign-in page. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000
const CALLBACK_PATH = '/callback'

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Hiveory</title><body style="font:16px system-ui,sans-serif;padding:64px 24px;text-align:center"><h1 style="font-size:20px">${title}</h1><p>${text}</p></body>`

/** The port a stored registration's redirect URI uses, so it stays valid across sign-ins. */
const registeredPort = (client: OAuthClientInformationMixed | undefined): number => {
  const uri = client && 'redirect_uris' in client ? client.redirect_uris[0] : undefined
  try {
    return uri ? Number(new URL(uri).port) || 0 : 0
  } catch {
    return 0
  }
}

/** A one-shot page on 127.0.0.1 that the browser returns to with the code (RFC 8252). */
class Loopback {
  private server: Server | null = null
  private settle: ((outcome: { code: string } | { error: string }) => void) | null = null
  readonly result: Promise<{ code: string } | { error: string }>
  url = ''

  constructor(private readonly expectedState: () => string | undefined) {
    this.result = new Promise((resolve) => (this.settle = resolve))
  }

  async listen(port: number): Promise<void> {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const ok = Boolean(code) && url.searchParams.get('state') === this.expectedState()
      // Fixed text only: nothing from the query string is echoed into the page.
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        .end(ok ? PAGE('Signed in', 'You can close this tab and go back to Hiveory.') : PAGE('Sign-in did not finish', 'Go back to Hiveory and try again.'))
      this.settle?.(ok ? { code: code! } : { error: url.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Sign-in did not finish. Try again.' })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => resolve())
    })
    this.server = server
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${CALLBACK_PATH}`
  }

  async code(): Promise<string> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<{ error: string }>((resolve) => (timer = setTimeout(() => resolve({ error: 'Sign-in timed out. Try again.' }), SIGN_IN_TIMEOUT_MS)))
    const outcome = await Promise.race([this.result, timeout]).finally(() => clearTimeout(timer))
    if ('error' in outcome) throw new Error(outcome.error)
    return outcome.code
  }

  close(): void {
    this.server?.close()
    this.server = null
  }
}

/**
 * OAuth for a remote MCP server the user signs in to with their own account,
 * such as Composio (ADR 0023). Hiveory is a public client: dynamic registration
 * plus PKCE, with the browser returning to a one-shot loopback page. The
 * registration and tokens are sealed on the connection; the PKCE verifier and
 * state only live in memory for one sign-in.
 *
 * Only a user action signs in. When a background start needs the browser,
 * `redirectToAuthorization` fails with a hint instead of opening one.
 */
export class ConnectionOAuth implements OAuthClientProvider {
  private loopback: Loopback | null = null
  private verifier = ''
  private expected: string | undefined

  constructor(
    private saved: OAuthState,
    private readonly persist: (state: OAuthState) => void,
    private readonly openBrowser: (url: string) => void,
    private readonly name: string
  ) {}

  get signedIn(): boolean {
    return Boolean(this.saved.tokens?.access_token)
  }

  /** Token values, masked in anything shown to agents or the user. */
  get secrets(): string[] {
    return [this.saved.tokens?.access_token, this.saved.tokens?.refresh_token].filter((s): s is string => Boolean(s))
  }

  get redirectUrl(): string {
    const client = this.saved.client
    return this.loopback?.url || (client && 'redirect_uris' in client ? client.redirect_uris[0] : undefined) || `http://127.0.0.1${CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Hiveory',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'openid offline_access'
    }
  }

  state(): string {
    this.expected = randomBytes(16).toString('hex')
    return this.expected
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const client = this.saved.client
    // A registration made for another loopback port can't receive this sign-in: register again.
    if (this.loopback && client && 'redirect_uris' in client && !client.redirect_uris.includes(this.loopback.url)) return undefined
    return client
  }

  saveClientInformation(client: OAuthClientInformationMixed): void {
    this.save({ ...this.saved, client })
  }

  tokens(): OAuthTokens | undefined {
    return this.saved.tokens
  }

  saveTokens(tokens: OAuthTokens): void {
    this.save({ ...this.saved, tokens })
  }

  redirectToAuthorization(url: URL): void {
    if (!this.loopback) throw new Error(`${this.name} needs you to sign in again: Settings › Plugins › ${this.name}.`)
    if (url.protocol !== 'https:') throw new Error(`${this.name} asked to sign in over an insecure link.`)
    this.openBrowser(url.href)
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier
  }

  codeVerifier(): string {
    return this.verifier
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'verifier') this.verifier = ''
    else if (scope === 'client') this.save({ ...this.saved, client: undefined })
    else if (scope === 'tokens') this.save({ ...this.saved, tokens: undefined })
    else if (scope === 'all') this.save({})
  }

  /**
   * Makes sure the user is signed in: refreshes a stored token silently, or opens
   * the provider's sign-in page in the browser and waits for it to come back.
   */
  async signIn(serverUrl: URL): Promise<void> {
    const loopback = new Loopback(() => this.expected)
    try {
      await loopback.listen(registeredPort(this.saved.client))
    } catch {
      await loopback.listen(0)
    }
    this.loopback = loopback
    try {
      if ((await auth(this, { serverUrl })) === 'REDIRECT') await auth(this, { serverUrl, authorizationCode: await loopback.code() })
    } finally {
      loopback.close()
      this.loopback = null
      this.verifier = ''
    }
  }

  private save(state: OAuthState): void {
    this.saved = state
    this.persist(state)
  }
}
