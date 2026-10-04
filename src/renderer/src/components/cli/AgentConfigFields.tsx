import type { CliSelection } from '@shared/domain'
import { useClis } from '../../stores/data'
import { Toggle } from '../ui/Toggle'
import { CliSelector } from './CliSelector'
import styles from './AgentConfigFields.module.css'

export interface AgentConfig {
  cliSelections: CliSelection[]
  autoApprove: boolean
  /** Agents open as a chat instead of a terminal (chat-capable CLIs only). */
  chatUi: boolean
}

interface AgentConfigFieldsProps {
  value: AgentConfig
  onChange: (value: AgentConfig) => void
}

/**
 * The CLI configuration surface: counts per CLI, auto-approve and chat view. The same
 * component backs Workspace creation and preset editing, so the two can never drift.
 */
export function AgentConfigFields({ value, onChange }: AgentConfigFieldsProps) {
  const clis = useClis((s) => s.clis)
  const selected = value.cliSelections.map((s) => clis.find((c) => c.id === s.cliId)).filter((c) => c !== undefined)
  const unsupported = selected.filter((c) => !c.supportsAutoApprove).map((c) => c.displayName)
  const noChat = selected.filter((c) => !c.supportsChat).map((c) => c.displayName)

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
      <div className={styles.toggleRow}>
        <div className={styles.toggleText}>
          <span className={styles.toggleLabel}>Use chat UI</span>
          <span className={styles.toggleHint}>
            Agents open as a clean chat instead of a terminal.
            {value.chatUi && noChat.length > 0 && ` ${noChat.join(', ')} will keep a terminal.`}
          </span>
        </div>
        <Toggle label="Use chat UI" checked={value.chatUi} onChange={(chatUi) => onChange({ ...value, chatUi })} />
      </div>
    </div>
  )
}
