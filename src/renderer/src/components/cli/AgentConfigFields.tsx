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
 * The CLI configuration surface: counts per CLI plus auto-approve. The same
 * component backs Workspace creation and preset editing, so the two can never drift.
 */
export function AgentConfigFields({ value, onChange }: AgentConfigFieldsProps) {
  const clis = useClis((s) => s.clis)
  const unsupported = value.cliSelections
    .map((s) => clis.find((c) => c.id === s.cliId))
    .filter((c) => c && !c.supportsAutoApprove)
    .map((c) => c!.displayName)

  return (
    <div className={styles.root}>
      <CliSelector value={value.cliSelections} onChange={(cliSelections) => onChange({ ...value, cliSelections })} />
      <div className={styles.toggleRow}>
        <div className={styles.toggleText}>
          <span className={styles.toggleLabel}>
            Auto-approve permissions
          </span>
          <span className={styles.toggleHint}>
            Agents run without asking before edits and commands.
            {value.autoApprove && unsupported.length > 0 && ` Not available for ${unsupported.join(', ')}.`}
          </span>
        </div>
        <Toggle
          label="Auto-approve permissions"
          checked={value.autoApprove}
          onChange={(autoApprove) => onChange({ ...value, autoApprove })}
        />
      </div>
    </div>
  )
}
