import { MessagesSquare, ShieldCheck } from 'lucide-react'
import type { AgentPreset } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import styles from './Presets.module.css'

/** Compact "logo ×N" summary of a preset's CLI configuration. */
export function PresetSummary({ preset }: { preset: AgentPreset }) {
  return (
    <span className={styles.summary}>
      {preset.cliSelections.map((s) => (
        <span key={s.cliId} className={styles.summaryItem}>
          <CliLogo cliId={s.cliId} size="sm" />×{s.count}
        </span>
      ))}
      {preset.autoApprove && (
        <span className={styles.summaryItem} title="Auto-approve on">
          <ShieldCheck aria-label="Auto-approve on" />
        </span>
      )}
      {preset.chatUi && (
        <span className={styles.summaryItem} title="Chat UI on">
          <MessagesSquare aria-label="Chat UI on" />
        </span>
      )}
    </span>
  )
}
