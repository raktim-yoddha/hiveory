import { marked, type Token } from 'marked'

/** How agent replies are read: GitHub-flavored, a line break is a break. */
const OPTIONS = { gfm: true, breaks: true }

/** A reply's markdown as HTML in one go (before sanitizing): what a finished reply shows. */
export const markdownHtml = (text: string): string => marked.parse(text, { ...OPTIONS, async: false }) as string

/** What `marked.parse` would use: marked's defaults with ours on top (`lexer` and `parser` take a full set). */
const fullOptions = () => ({ ...marked.defaults, ...OPTIONS, async: false as const })

export interface MarkdownBlock {
  /** The block's own source text: while it does not change, its HTML does not either. */
  raw: string
  html: string
}

/**
 * A reply cut into its top-level blocks (paragraphs, lists, code, tables…), each with its HTML
 * (ADR 0068). Joined, the blocks' HTML is exactly `markdownHtml(text)`, at every point of a
 * stream, so a streaming reply can redraw only the block still being written. `cache` maps a
 * block's source to HTML already made; reference links resolve as the whole text says, so the
 * cache is dropped whenever the link definitions change.
 */
export const markdownBlocks = (text: string, cache: MarkdownCache): MarkdownBlock[] => {
  const tokens = marked.lexer(text, fullOptions())
  // Names and targets: a definition still being written changes its target as it streams.
  const links = JSON.stringify(tokens.links)
  if (cache.links !== links) {
    cache.links = links
    cache.html.clear()
  }
  // The parser joins top-level text tokens that follow each other; they stay one block here too.
  const groups: Token[][] = []
  for (const token of tokens) {
    const last = groups.at(-1)
    if (token.type === 'text' && last?.at(-1)?.type === 'text') last.push(token)
    else groups.push([token])
  }
  const used = new Map<string, string>()
  const blocks = groups.map((group) => {
    const raw = group.map((t) => t.raw).join('')
    const html = cache.html.get(raw) ?? used.get(raw) ?? marked.parser(Object.assign(group, { links: tokens.links }), fullOptions())
    used.set(raw, html)
    return { raw, html }
  })
  // Only what this text uses is kept, so the cache never outgrows the reply.
  cache.html = used
  return blocks
}

/** HTML made for blocks so far, and the link definitions it was made under. */
export interface MarkdownCache {
  html: Map<string, string>
  links: string
}

export const markdownCache = (): MarkdownCache => ({ html: new Map(), links: '' })
