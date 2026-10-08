const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e]!)
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The plain-text highlights of a GitHub release body (HTML, as electron-updater passes it): the list
 * under a "Highlights" heading, else the first list. Shown as text, never as HTML.
 */
export const releaseHighlights = (html: string | undefined, max = 3): string[] => {
  if (!html) return []
  const fromHeading = /highlights\s*<\/h\d>\s*<ul>([\s\S]*?)<\/ul>/i.exec(html)?.[1]
  const list = fromHeading ?? /<ul>([\s\S]*?)<\/ul>/i.exec(html)?.[1] ?? ''
  return [...list.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((m) => text(m[1]!)).filter(Boolean).slice(0, max)
}
