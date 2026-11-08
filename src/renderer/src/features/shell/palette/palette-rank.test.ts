import { describe, expect, it } from 'vitest'
import { rankPalette, type PaletteItem } from './palette-rank'

const item = (label: string, group = 'Commands', hint?: string): PaletteItem => ({ id: label, label, group, hint, run: () => undefined })
const labels = (items: PaletteItem[]) => items.map((i) => i.label)

describe('command palette ranking (ADR 0060)', () => {
  const items = [
    item('Open or close Settings', 'General'),
    item('New worktree in this workspace', 'Lists'),
    item('Next worktree', 'Lists'),
    item('feature-login', 'Go to', 'demo-app'),
    item('Usage', 'Settings'),
    item('Changes', 'Side panel')
  ]

  it('keeps the order for an empty or blank query', () => {
    expect(labels(rankPalette(items, ''))).toEqual(labels(items))
    expect(labels(rankPalette(items, '   '))).toEqual(labels(items))
  })

  it('puts a label that starts with the query first', () => {
    expect(labels(rankPalette(items, 'next'))[0]).toBe('Next worktree')
    expect(labels(rankPalette(items, 'NEW'))[0]).toBe('New worktree in this workspace')
  })

  it('needs every word, found in the label, hint or group', () => {
    expect(labels(rankPalette(items, 'worktree new'))).toEqual(['New worktree in this workspace'])
    expect(labels(rankPalette(items, 'demo login'))).toEqual(['feature-login'])
    expect(labels(rankPalette(items, 'settings usage'))).toEqual(['Usage'])
  })

  it('matches letters in order, and nothing for letters that are not there', () => {
    expect(labels(rankPalette(items, 'chgs'))).toEqual(['Changes'])
    expect(rankPalette(items, 'zzz')).toEqual([])
  })

  it('takes characters that mean something in a pattern as plain text', () => {
    expect(() => rankPalette([item('a (b) [c] *d?')], '(b) [c *d?')).not.toThrow()
    expect(labels(rankPalette([item('a (b) [c] *d?')], '[c]'))).toEqual(['a (b) [c] *d?'])
  })
})
