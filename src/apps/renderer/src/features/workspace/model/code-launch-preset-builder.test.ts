import { describe, expect, it } from 'vitest'
import { entryGroupKey, groupPresetEntries, hasDuplicatePaneTitles, nextPetPaneTitle } from './code-launch-preset-builder'

describe('code launch preset builder', () => {
  it('keeps normal and YOLO agent panes in separate quantity groups', () => {
    const entries = [
      { id: 'one', kind: 'coding_agent' as const, title: 'Amber Fox', adapter_id: 'codex', url: null, agent_launch_mode: 'standard' as const },
      { id: 'two', kind: 'coding_agent' as const, title: 'Cedar Lark', adapter_id: 'codex', url: null, agent_launch_mode: 'yolo' as const },
    ]
    expect(groupPresetEntries(entries)).toHaveLength(2)
    expect(entryGroupKey(entries[0])).not.toBe(entryGroupKey(entries[1]))
  })

  it('creates a unique pet-style name even when its first choice is already used', () => {
    expect(nextPetPaneTitle(['Amber Badger'], 0)).toBe('Amber Finch')
  })

  it('treats pane names case-insensitively when checking uniqueness', () => {
    expect(hasDuplicatePaneTitles([{ title: 'Mossy Otter' }, { title: 'mossy otter' }])).toBe(true)
    expect(hasDuplicatePaneTitles([{ title: 'Mossy Otter' }, { title: 'Velvet Wren' }])).toBe(false)
  })
})
