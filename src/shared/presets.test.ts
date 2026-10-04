import { describe, expect, it } from 'vitest'
import { MAX_INSTANCES_PER_CLI, presetInputSchema } from './ipc/contract'
import { normalizeSelections, serializePreset, totalInstances } from './presets'

describe('preset serialization', () => {
  it('merges duplicates, drops zero counts and clamps', () => {
    expect(
      normalizeSelections([
        { cliId: 'claude', count: 1 },
        { cliId: 'codex', count: 0 },
        { cliId: 'claude', count: 1 },
        { cliId: 'gemini', count: 99 }
      ])
    ).toEqual([
      { cliId: 'claude', count: 2 },
      { cliId: 'gemini', count: MAX_INSTANCES_PER_CLI }
    ])
  })

  it('keeps only documented fields — never layout', () => {
    const withExtras = {
      id: 'p1',
      name: '  Pair  ',
      cliSelections: [{ cliId: 'claude', count: 2 }],
      autoApprove: true,
      layout: { type: 'pane', paneId: 'x' },
      path: 'C:/repo'
    }
    expect(serializePreset(withExtras)).toEqual({
      id: 'p1',
      name: 'Pair',
      cliSelections: [{ cliId: 'claude', count: 2 }],
      autoApprove: true,
      chatUi: false
    })
  })

  it('round-trips through JSON', () => {
    const preset = serializePreset({ id: 'p', name: 'Trio', cliSelections: [{ cliId: 'codex', count: 3 }], autoApprove: false })
    expect(serializePreset(JSON.parse(JSON.stringify(preset)))).toEqual(preset)
    expect(totalInstances(preset.cliSelections)).toBe(3)
  })

  it('validates IPC input', () => {
    expect(presetInputSchema.safeParse({ name: '', cliSelections: [], autoApprove: false }).success).toBe(false)
    expect(
      presetInputSchema.safeParse({ name: 'x', cliSelections: [{ cliId: '../evil', count: 1 }], autoApprove: false }).success
    ).toBe(false)
  })
})
