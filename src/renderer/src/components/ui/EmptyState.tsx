import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  icon?: ReactNode
  /** Rendered as-is instead of the icon tile (e.g. the app logo). */
  media?: ReactNode
  title: string
  description?: ReactNode
  actions?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon, media, title, description, actions, compact }: EmptyStateProps) {
  return (
    <div className={cx(styles.root, compact && styles.compact)}>
      {media}
      {icon && !media && <div className={styles.icon}>{icon}</div>}
      <h3 className={styles.title}>{title}</h3>
      {description && <p className={styles.description}>{description}</p>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  )
}
