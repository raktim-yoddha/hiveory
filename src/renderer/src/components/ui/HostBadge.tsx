import { Server } from 'lucide-react'
import { hostLabel, type HostRef } from '@shared/domain'
import { cx } from '../../lib/cx'
import styles from './HostBadge.module.css'

/** Marks a project that lives on another machine (ADR 0022). Renders nothing for this computer. */
export function HostBadge({ host, iconOnly = false }: { host?: HostRef; iconOnly?: boolean }) {
  if (!host) return null
  const label = `On ${hostLabel(host)} over SSH`
  return (
    <span className={cx(styles.badge, iconOnly && styles.iconOnly)} title={label} aria-label={label} role="img">
      <Server aria-hidden />
      {!iconOnly && <span>{hostLabel(host)}</span>}
    </span>
  )
}
