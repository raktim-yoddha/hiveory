import { describe, expect, it } from 'vitest'
import { markdownBlocks, markdownCache, markdownHtml } from './markdown-blocks'

/** What agent replies contain: every block kind, in the orders that make markdown parsers stumble. */
const reply = [
  '# Plan',
  '',
  'First I read the files. This line ends with two spaces  ',
  'and this one follows *on the next line* with `code` and **bold**.',
  'Setext heading',
  '===',
  '',
  '- a tight list',
  '- with [a link](https://example.test) and ~~strike~~',
  '  - nested',
  '',
  '1. a loose list',
  '',
  '2. second item',
  '   continued lazily',
  '',
  '- [ ] a task',
  '- [x] done',
  '',
  '```ts',
  'const x = 1',
  '',
  'const y = 2 // a blank line inside a fence',
  '```',
  '',
  '> a quote',
  '> - with a list',
  '',
  '| Column | Other |',
  '| --- | :---: |',
  '| a | b |',
  '| c | d |',
  '',
  'See [the docs][docs] and [missing][nope] and <https://auto.test>.',
  '',
  '---',
  '',
  '    indented code',
  '',
  '<details>',
  '<summary>raw html</summary>',
  '',
  'inside it',
  '',
  '</details>',
  '',
  'Ends without a newline and a trailing \\',
  '',
  '[docs]: https://docs.test "Docs"',
  'after the definition'
].join('\n')

const joined = (text: string): string =>
  markdownBlocks(text, markdownCache())
    .map((b) => b.html)
    .join('')

describe('markdown by blocks (ADR 0068)', () => {
  it('joined, the blocks are exactly the whole reply rendered at once', () => {
    expect(joined(reply)).toBe(markdownHtml(reply))
  })

  it('stays exactly the same as rendering at once at every point of a stream, with the cache in use', () => {
    const cache = markdownCache()
    for (let end = 0; end <= reply.length; end++) {
      const text = reply.slice(0, end)
      const html = markdownBlocks(text, cache).map((b) => b.html).join('')
      if (html !== markdownHtml(text)) expect({ end, html }).toEqual({ end, html: markdownHtml(text) })
    }
  })

  it('reuses what it made for blocks that did not change, and only those', () => {
    const cache = markdownCache()
    const first = markdownBlocks('# Title\n\nOne paragraph.\n\nSecond, still being wr', cache)
    const next = markdownBlocks('# Title\n\nOne paragraph.\n\nSecond, still being written', cache)
    expect(next.length).toBe(first.length)
    // The same string object: nothing was made again for the finished blocks.
    expect(next[0]!.html).toBe(first[0]!.html)
    expect(next[2]!.html).toBe(first[2]!.html)
    expect(next.at(-1)!.html).not.toBe(first.at(-1)!.html)
    expect(cache.html.size).toBeLessThanOrEqual(next.length)
  })

  it('renders a block again when a link definition arrives later in the reply', () => {
    const cache = markdownCache()
    const before = markdownBlocks('Read [the guide][g].\n\n', cache)
    const after = markdownBlocks('Read [the guide][g].\n\n[g]: https://guide.test', cache)
    expect(before[0]!.html).not.toContain('href')
    expect(after[0]!.html).toContain('href="https://guide.test"')
  })

  it('handles an empty reply', () => {
    expect(markdownBlocks('', markdownCache())).toEqual([])
  })
})
