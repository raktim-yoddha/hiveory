const ALLOWED = /^(https?:|file:|about:blank$)/i
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?([/?#]|$)/i

/**
 * Turns what a user or agent typed into a loadable URL: bare hosts get a
 * scheme (http for local dev servers), anything else becomes a web search.
 * Only http(s), file and about:blank are ever loaded.
 */
export const normalizeUrl = (input: string): string => {
  const text = input.trim()
  if (!text) return 'about:blank'
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !LOCAL_HOST.test(text)) {
    if (ALLOWED.test(text)) return text
    throw new Error(`Only http(s), file and about:blank addresses can be opened (got "${text.slice(0, 80)}").`)
  }
  if (LOCAL_HOST.test(text)) return `http://${text}`
  if (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}([/:?#]|$)/i.test(text)) return `https://${text}`
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}

/** Scale that fits an emulated viewport inside the visible area (never enlarges). */
export const fitScale = (viewport: { width: number; height: number }, area: { width: number; height: number }): number =>
  Math.min(1, area.width / viewport.width, area.height / viewport.height)
