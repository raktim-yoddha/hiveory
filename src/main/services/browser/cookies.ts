/** Electron `cookies.set` details (kept local so this module stays pure and testable). */
export interface CookieInput {
  url: string
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

const SAME_SITE: Record<string, CookieInput['sameSite']> = {
  none: 'no_restriction',
  no_restriction: 'no_restriction',
  lax: 'lax',
  strict: 'strict',
  unspecified: 'unspecified'
}

const toInput = (c: {
  name: string
  value: string
  domain: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expires?: number
  sameSite?: string
  hostOnly?: boolean
}): CookieInput => {
  const host = c.domain.replace(/^\./, '')
  const path = c.path || '/'
  return {
    url: `${c.secure ? 'https' : 'http'}://${host}${path}`,
    name: c.name,
    value: c.value,
    // A host-only cookie must not carry a domain, or it would widen to subdomains.
    ...(c.hostOnly ? {} : { domain: c.domain }),
    path,
    secure: Boolean(c.secure),
    httpOnly: Boolean(c.httpOnly),
    ...(c.expires && c.expires > 0 ? { expirationDate: c.expires } : {}),
    ...(c.sameSite && SAME_SITE[c.sameSite.toLowerCase()] ? { sameSite: SAME_SITE[c.sameSite.toLowerCase()] } : {})
  }
}

/**
 * Parses an exported cookie file: a JSON array (Cookie-Editor / EditThisCookie /
 * Hiveory export), a Playwright `storageState` object, or Netscape cookies.txt.
 */
export const parseCookieFile = (text: string): CookieInput[] => {
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed) as unknown
    const list = Array.isArray(data) ? data : (data as { cookies?: unknown }).cookies
    if (!Array.isArray(list)) throw new Error('No cookies found in this JSON file.')
    return list.flatMap((raw) => {
      const c = raw as Record<string, unknown>
      if (typeof c.name !== 'string' || typeof c.domain !== 'string' || typeof c.value !== 'string') return []
      const expires = typeof c.expirationDate === 'number' ? c.expirationDate : typeof c.expires === 'number' ? c.expires : undefined
      return [
        toInput({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: typeof c.path === 'string' ? c.path : '/',
          secure: c.secure === true,
          httpOnly: c.httpOnly === true,
          expires,
          sameSite: typeof c.sameSite === 'string' ? c.sameSite : undefined,
          hostOnly: c.hostOnly === true
        })
      ]
    })
  }
  return trimmed.split(/\r?\n/).flatMap((line) => {
    const httpOnly = line.startsWith('#HttpOnly_')
    const body = httpOnly ? line.slice('#HttpOnly_'.length) : line
    if (!body || body.startsWith('#')) return []
    const parts = body.split('\t')
    if (parts.length < 7) return []
    const [domain, includeSubdomains, path, secure, expires, name, ...value] = parts as [string, string, string, string, string, string, ...string[]]
    return [
      toInput({
        name,
        value: value.join('\t'),
        domain,
        path,
        secure: secure.toUpperCase() === 'TRUE',
        httpOnly,
        expires: Number(expires),
        hostOnly: includeSubdomains.toUpperCase() !== 'TRUE'
      })
    ]
  })
}
