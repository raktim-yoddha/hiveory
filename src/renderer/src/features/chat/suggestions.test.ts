import { describe, expect, it } from 'vitest'
import { applySuggestion, findTrigger } from './suggestions'
import { buildChangeTree, diffLines, shortCount } from '../changes/change-tree'

describe('composer suggestions (ADR 0058)', () => {
  it('finds a slash command only at the start of the message', () => {
    expect(findTrigger('/rev', 4)).toEqual({ kind: '/', query: 'rev', start: 0 })
    expect(findTrigger('please /rev', 11)).toBeNull()
    expect(findTrigger('/review now', 11)).toBeNull()
  })

  it('finds an @ mention anywhere after a space', () => {
    expect(findTrigger('look at @src/ma', 15)).toEqual({ kind: '@', query: 'src/ma', start: 8 })
    expect(findTrigger('@', 1)).toEqual({ kind: '@', query: '', start: 0 })
    expect(findTrigger('mail me@x', 9)).toBeNull()
  })

  it('replaces the token and puts the caret after it', () => {
    const trigger = findTrigger('see @ma and more', 7)!
    expect(applySuggestion('see @ma and more', 7, trigger, 'src/main.ts')).toEqual({ text: 'see @src/main.ts and more', caret: 17 })
    expect(applySuggestion('/re', 3, findTrigger('/re', 3)!, 'review')).toEqual({ text: '/review ', caret: 8 })
  })
})

describe('changes tree (ADR 0058)', () => {
  const file = (path: string, additions = 1, deletions = 0) => ({ path, status: 'modified' as const, additions, deletions })

  it('groups files under folders with summed counts, joining single-folder chains', () => {
    const tree = buildChangeTree([file('packages/web/src/a.ts', 2, 1), file('packages/web/src/b.ts', 3), file('README.md', 1, 1)])
    expect(tree.map((n) => n.name)).toEqual(['packages/web/src', 'README.md'])
    const folder = tree[0]!
    expect(folder.kind === 'folder' && [folder.additions, folder.deletions, folder.children.length]).toEqual([5, 1, 2])
  })

  it('colors a unified diff and drops its headers', () => {
    const lines = diffLines('diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n same')
    expect(lines.map((l) => l.kind)).toEqual(['hunk', 'del', 'add', 'context'])
  })

  it('shortens big counts', () => {
    expect([shortCount(684), shortCount(1900), shortCount(12_400)]).toEqual(['684', '1.9k', '12k'])
  })
})
