import { useEffect } from 'react'
import { Server } from 'lucide-react'
import { hostKey, hostLabel, type HostLinkStatus, type HostRef } from '@shared/domain'
import { cx } from '../../lib/cx'
import { useHostLinks } from '../../stores/hosts'
import styles from './HostBadge.module.css'

const SAYS: Record<HostLinkStatus, string> = {
  connecting: 'connecting',
  connected: 'connected',
  reconnecting: 'reconnecting; its agents keep running there',
  offline: 'not connected'
}

/**
 * Marks a project that lives on another machine (ADR 0022), with the live state
 * of the link to it (ADR 0025). Renders nothing for this computer.
 */
export function HostBadge({ host, iconOnly = false }: { host?: HostRef; iconOnly?: boolean }) {
  const status = useHostLinks((s) => (host ? s.statuses[hostKey(host)] : undefined))
  useEffect(() => useHostLinks.getState().ensure(), [])
  if (!host) return null
  const label = `On ${hostLabel(host)} over SSH${status ? `, ${SAYS[status]}` : ''}`
  return (
    <span className={cx(styles.badge, iconOnly && styles.iconOnly)} title={label} aria-label={label} role="img">
      <Server aria-hidden />
      {!iconOnly && <span>{hostLabel(host)}</span>}
      {status && <i className={cx(styles.dot, styles[status])} aria-hidden />}
    </span>
  )
}
