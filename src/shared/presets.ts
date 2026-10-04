import type { AgentPreset, CliSelection } from './domain'
import { MAX_INSTANCES_PER_CLI } from './ipc/contract'

/**
 * Canonical CLI configuration: one entry per CLI, counts clamped to
 * 1..MAX_INSTANCES_PER_CLI, zero-count entries dropped, order preserved.
 */
export const normalizeSelections = (selections: CliSelection[]): CliSelection[] => {
  const counts = new Map<string, number>()
  for (const { cliId, count } of selections) {
    counts.set(cliId, (counts.get(cliId) ?? 0) + Math.max(0, Math.floor(count)))
  }
  return [...counts]
    .filter(([, count]) => count > 0)
    .map(([cliId, count]) => ({ cliId, count: Math.min(count, MAX_INSTANCES_PER_CLI) }))
}

/** Only the documented preset fields survive serialization — never layout or paths (ADR 0003). */
export const serializePreset = (preset: AgentPreset): AgentPreset => ({
  id: preset.id,
  name: preset.name.trim(),
  cliSelections: normalizeSelections(preset.cliSelections),
  autoApprove: preset.autoApprove
})

export const totalInstances = (selections: CliSelection[]): number =>
  selections.reduce((sum, s) => sum + s.count, 0)
