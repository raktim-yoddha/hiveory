import type { CliSelection } from './cli'

/** Presets store CLI configuration only — never layout (ADR 0003). */
export interface AgentPreset {
  id: string
  name: string
  cliSelections: CliSelection[]
  autoApprove: boolean
}
