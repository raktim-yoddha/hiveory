import type { ConnectionView } from '@shared/domain'
import { cx } from '../../../lib/cx'
import styles from './Extensions.module.css'

/** Dot + words for a connection: ready (with tool count), connecting, error, or not tried yet. */
export function ConnectionStatus({ connection }: { connection: ConnectionView }) {
  const text = !connection.enabled
    ? 'Off'
    : connection.state === 'ready'
      ? `${connection.tools.length} tool${connection.tools.length === 1 ? '' : 's'}`
      : connection.state === 'connecting'
        ? 'Connecting…'
        : connection.state === 'error'
          ? 'Error'
          : 'Not connected'
  return (
    <span className={cx(styles.status, connection.enabled && styles[connection.state])} title={connection.error}>
      <span className={styles.dot} aria-hidden />
      {text}
    </span>
  )
}
