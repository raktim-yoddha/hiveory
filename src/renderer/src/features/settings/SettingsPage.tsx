import type { ReactNode } from 'react'
import styles from './Settings.module.css'

/*
 * Shared section scaffolding for Settings and a Workspace's settings. Its own module, so a screen that
 * shows a setting row never loads the whole Settings window with it (ADR 0044).
 */

export function SettingsPage({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>{title}</h2>
        {description && <p className={styles.pageDescription}>{description}</p>}
      </header>
      {children}
    </div>
  )
}

export function SettingRow({ title, description, control }: { title: string; description?: ReactNode; control: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>{title}</span>
        {description && <span className={styles.rowDescription}>{description}</span>}
      </div>
      <div className={styles.rowControl}>{control}</div>
    </div>
  )
}
