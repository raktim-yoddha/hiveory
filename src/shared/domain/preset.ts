import type { CliSelection } from './cli'

/** Presets store CLI configuration only — never layout (ADR 0003). */
export interface AgentPreset {
  id: string
  name: string
  cliSelections: CliSelection[]
  autoApprove: boolean
  /** Agents use the chat view instead of a terminal (ADR 0013). */
  chatUi?: boolean
}
