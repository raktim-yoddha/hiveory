import { useClis } from '../../stores/data'
import { cx } from '../../lib/cx'
import { CliLogo } from './CliLogo'
import styles from './CliStack.module.css'

/**
 * Several CLIs as one compact, overlapping stack of logos: the first few, then "+N".
 * Scales to any number of CLIs; the names are in the tooltip and accessible label.
 */
export function CliStack({ cliIds, max = 4, className }: { cliIds: string[]; max?: number; className?: string }) {
  const clis = useClis((s) => s.clis)
  if (!cliIds.length) return null
  const names = cliIds.map((id) => clis.find((c) => c.id === id)?.displayName ?? id)
  const shown = cliIds.length > max ? cliIds.slice(0, max - 1) : cliIds
  const more = cliIds.length - shown.length
  const label = names.join(', ')
  return (
    <span className={cx(styles.stack, className)} role="img" aria-label={label} title={label}>
      {shown.map((id) => (
        <span key={id} className={styles.item} aria-hidden>
          <CliLogo cliId={id} size="sm" />
        </span>
      ))}
      {more > 0 && (
        <span className={cx(styles.item, styles.more)} aria-hidden>
          +{more}
        </span>
      )}
    </span>
  )
}
