import type { CliStatus } from '@shared/domain'
import { cx } from '../../lib/cx'
import styles from './StatusDot.module.css'

export const STATUS_LABEL: Record<CliStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  'waiting-for-you': 'Waiting for you'
}

interface StatusDotProps {
  status: CliStatus
  /** Dim the dot when no process is attached. */
  running?: boolean
  /** Extra context (e.g. the waiting reason) for the accessible label and tooltip only. */
  detail?: string
}

/** Status is shown by color; words live only in the label/tooltip. */
export function StatusDot({ status, running = true, detail }: StatusDotProps) {
  const label = running ? (detail ?? STATUS_LABEL[status]) : 'Not running'
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cx(styles.dot, styles[status], !running && styles.stopped)}
    />
  )
}
