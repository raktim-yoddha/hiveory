import { describe, expect, it } from 'vitest'
import { entryGroupKey, groupPresetEntries, hasDuplicatePaneTitles, nextPetPaneTitle } from './code-launch-preset-builder'

describe('code launch preset builder', () => {
  it('keeps normal and YOLO agent panes in separate quantity groups', () => {
    const entries = [
      { id: 'one', kind: 'coding_agent' as const, title: 'Biscuit', adapter_id: 'codex', url: null, agent_launch_mode: 'standard' as const },
      { id: 'two', kind: 'coding_agent' as const, title: 'Button', adapter_id: 'codex', url: null, agent_launch_mode: 'yolo' as const },
    ]
    expect(groupPresetEntries(entries)).toHaveLength(2)
    expect(entryGroupKey(entries[0])).not.toBe(entryGroupKey(entries[1]))
  })

  it('keeps terminal shell profiles in separate quantity groups', () => {
    const entries = [
      { id: 'default', kind: 'terminal' as const, title: 'Biscuit', adapter_id: null, url: null, agent_launch_mode: 'standard' as const },
      { id: 'powershell', kind: 'terminal' as const, title: 'Button', adapter_id: 'powershell', url: null, agent_launch_mode: 'standard' as const },
      { id: 'git-bash', kind: 'terminal' as const, title: 'Clover', adapter_id: 'git-bash', url: null, agent_launch_mode: 'standard' as const },
    ]
    expect(groupPresetEntries(entries).map((group) => group.adapterId)).toEqual([null, 'powershell', 'git-bash'])
  })

  it('creates a unique one-word pet name even when its first choice is already used', () => {
    expect(nextPetPaneTitle(['Biscuit'], 0)).toBe('Button')
  })

  it('keeps fallback pet names as one word after the catalog is exhausted', () => {
    expect(nextPetPaneTitle(['Biscuit', 'Button', 'Clover', 'Comet', 'Doodle', 'Fidget', 'Gizmo', 'Juniper', 'Kestrel', 'Mochi', 'Nimbus', 'Noodle', 'Pebble', 'Pickle', 'Pippin', 'Poppy', 'Quartz', 'Rocket', 'Saffron', 'Sprout', 'Tango', 'Waffles', 'Whisker', 'Wicket', 'Ziggy'], 0)).toBe('Biscuit2')
  })

  it('treats pane names case-insensitively when checking uniqueness', () => {
    expect(hasDuplicatePaneTitles([{ title: 'Mochi' }, { title: 'mochi' }])).toBe(true)
    expect(hasDuplicatePaneTitles([{ title: 'Mochi' }, { title: 'Ziggy' }])).toBe(false)
  })
})
