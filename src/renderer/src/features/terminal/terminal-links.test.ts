import { describe, expect, it } from 'vitest'
import { findTerminalLinks, pathInWorktree } from './terminal-links'

const only = (line: string) => findTerminalLinks(line).map((l) => (l.kind === 'url' ? `url:${l.url}` : `file:${l.path}:${l.line ?? ''}:${l.col ?? ''}`))

describe('findTerminalLinks', () => {
  it('finds URLs and trims the punctuation around them', () => {
    expect(only('Local: http://localhost:5173/ ready.')).toEqual(['url:http://localhost:5173/'])
    expect(only('see (https://example.com/a_(b)) now')).toEqual(['url:https://example.com/a_(b)'])
    expect(only('[docs](https://example.com/x).')).toEqual(['url:https://example.com/x'])
    expect(only('"https://example.com/q?a=1&b=2",')).toEqual(['url:https://example.com/q?a=1&b=2'])
  })

  it('gives the exact span of each link', () => {
    const [link] = findTerminalLinks('open http://127.0.0.1:3000 now')
    expect(link).toMatchObject({ start: 5, end: 26, text: 'http://127.0.0.1:3000' })
  })

  it('finds file paths with lines and columns in the common formats', () => {
    expect(only('src/app/main.ts:12:5 error')).toEqual(['file:src/app/main.ts:12:5'])
    expect(only('at fn (C:\\code\\app\\index.js:40:2)')).toEqual(['file:C:\\code\\app\\index.js:40:2'])
    expect(only('error in ./lib/util.py(7,3)')).toEqual(['file:./lib/util.py:7:3'])
    expect(only('see docs/guide.md#L30')).toEqual(['file:docs/guide.md:30:'])
    expect(only('Edited package.json and README.md')).toEqual(['file:package.json::', 'file:README.md::'])
    expect(only('/home/me/app/.env.local:3')).toEqual(['file:/home/me/app/.env.local:3:'])
  })

  it('leaves prose, versions and URL parts alone', () => {
    expect(only('e.g. node v1.2.3 is 1.5x faster, i.e. ok')).toEqual([])
    expect(only('fetch https://example.com/path/file.js now')).toEqual(['url:https://example.com/path/file.js'])
    expect(only('mail me@example.com')).toEqual([])
  })
})

describe('pathInWorktree', () => {
  it('keeps relative paths inside the worktree', () => {
    expect(pathInWorktree('./src/a.ts', '/home/me/app')).toBe('src/a.ts')
    expect(pathInWorktree('src\\b.ts', 'C:\\code\\app')).toBe('src/b.ts')
    expect(pathInWorktree('src/../lib/c.ts', '/home/me/app')).toBe('lib/c.ts')
  })

  it('maps absolute paths under the worktree, ignoring drive-letter case on Windows', () => {
    expect(pathInWorktree('/home/me/app/src/a.ts', '/home/me/app/')).toBe('src/a.ts')
    expect(pathInWorktree('c:\\Code\\App\\x.ts', 'C:\\code\\app')).toBe('x.ts')
  })

  it('refuses anything outside the worktree', () => {
    expect(pathInWorktree('../secret.txt', '/home/me/app')).toBeNull()
    expect(pathInWorktree('/home/me/application/x.ts', '/home/me/app')).toBeNull()
    expect(pathInWorktree('/etc/passwd.txt', '/home/me/app')).toBeNull()
    expect(pathInWorktree('~/notes.md', '/home/me/app')).toBeNull()
    expect(pathInWorktree('/home/me/app', '/home/me/app')).toBeNull()
  })
})
