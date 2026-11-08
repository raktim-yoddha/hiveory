import type { CliSelection } from '@shared/domain'
import { useClis } from '../../stores/data'
import { Toggle } from '../ui/Toggle'
import { CliSelector } from './CliSelector'
import styles from './AgentConfigFields.module.css'

export interface AgentConfig {
  cliSelections: CliSelection[]
  autoApprove: boolean
}

interface AgentConfigFieldsProps {
  value: AgentConfig
  onChange: (value: AgentConfig) => void
}

/**
 * The CLI configuration surface: counts per CLI and auto-approve (chat is its own "Chat UI", ADR 0059). The same
 * component backs Workspace creation and preset editing, so the two can never drift.
 */
export function AgentConfigFields({ value, onChange }: AgentConfigFieldsProps) {
  const clis = useClis((s) => s.clis)
  const selected = value.cliSelections.map((s) => clis.find((c) => c.id === s.cliId)).filter((c) => c !== undefined)
  const unsupported = selected.filter((c) => !c.supportsAutoApprove).map((c) => c.displayName)

  return (
    <div className={styles.root}>
      <CliSelector value={value.cliSelections} onChange={(cliSelections) => onChange({ ...value, cliSelections })} />
      <div className={styles.toggleRow}>
        <div className={styles.toggleText}>
          <span className={styles.toggleLabel}>
            Skip permissions (YOLO)
          </span>
          <span className={styles.toggleHint}>
            Agents start in their dangerous skip-permissions mode: no prompts before edits and commands.
            {value.autoApprove && unsupported.length > 0 && ` Not available for ${unsupported.join(', ')}.`}
          </span>
        </div>
        <Toggle
          label="Skip permissions (YOLO)"
          checked={value.autoApprove}
          onChange={(autoApprove) => onChange({ ...value, autoApprove })}
        />
      </div>
    </div>
  )
}
