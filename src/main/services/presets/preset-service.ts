import { randomUUID } from 'node:crypto'
import type { AgentPreset } from '@shared/domain'
import { fail } from '@shared/errors'
import type { RequestOf } from '@shared/ipc/contract'
import { serializePreset } from '@shared/presets'
import type { Emit } from '../events'
import type { StateStore } from '../persistence/state-store'

/** Global presets: CLI types, counts and auto-approve only (ADR 0003). */
export class PresetService {
  constructor(
    private readonly store: StateStore,
    private readonly emit: Emit
  ) {}

  list(): AgentPreset[] {
    return [...this.store.state.presets].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(presetId: string): AgentPreset {
    const preset = this.store.state.presets.find((p) => p.id === presetId)
    if (!preset) fail('NOT_FOUND', 'Preset not found.')
    return preset!
  }

  save(input: RequestOf<'presets.save'>): AgentPreset {
    const preset = serializePreset({ ...input, id: input.id ?? randomUUID() })
    if (preset.cliSelections.length === 0) {
      fail('INVALID_INPUT', 'A preset needs at least one agent.', { operation: 'Save preset' })
    }
    this.store.update((s) => {
      const index = s.presets.findIndex((p) => p.id === preset.id)
      if (index >= 0) s.presets[index] = preset
      else s.presets.push(preset)
    })
    this.emit('state.changed', { topic: 'presets' })
    return preset
  }

  delete(presetId: string): void {
    this.store.update((s) => {
      s.presets = s.presets.filter((p) => p.id !== presetId)
    })
    this.emit('state.changed', { topic: 'presets' })
  }
}
