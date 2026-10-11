import { useEffect, useRef, type ReactNode } from 'react'
import { BookOpen, Blocks, Download, GitPullRequest, Globe, Info, Palette, Server, X } from 'lucide-react'
import { AgentIcon } from '../../components/brand/AgentIcon'
import { QueenIcon } from '../../components/brand/QueenIcon'
import { IconButton } from '../../components/ui/Button'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { cx } from '../../lib/cx'
import { useSelectionBox } from '../../lib/useSelectionBox'
import { useNavigation, type SettingsSection } from '../../stores/navigation'
import { AboutSection } from './AboutSection'
import { AgentsSection } from './AgentsSection'
import { AppearanceSection } from './AppearanceSection'
import { BrowserSection } from './BrowserSection'
import { ExtensionsSection } from './ExtensionsSection'
import { IntegrationsSection } from './IntegrationsSection'
import { QueenSection } from './QueenSection'
import { RemoteSection } from './RemoteSection'
import { GuideSection } from './guide/GuideSection'
import { UpdatesSection } from './UpdatesSection'
import styles from './Settings.module.css'

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: ReactNode }> = [
  { id: 'appearance', label: 'Appearance', icon: <Palette /> },
  { id: 'agents', label: 'Agents', icon: <AgentIcon /> },
  { id: 'browser', label: 'Browser', icon: <Globe /> },
  { id: 'extensions', label: 'Skills, MCPs & Apps', icon: <Blocks /> },
  { id: 'integrations', label: 'Integrations', icon: <GitPullRequest /> },
  { id: 'queen', label: 'Queen Bee', icon: <QueenIcon /> },
  { id: 'remote', label: 'Remote', icon: <Server /> },
  { id: 'updates', label: 'Updates', icon: <Download /> },
  { id: 'guide', label: 'Guide', icon: <BookOpen /> },
  { id: 'about', label: 'About', icon: <Info /> }
]

/**
 * App-level settings (a Workspace's own live in its Dashboard), as a window over the app (ADR 0039):
 * what is behind stays in place, so appearance changes show at once. Escape or × closes it.
 */
export function SettingsScreen({ section }: { section: SettingsSection }) {
  const { openSettings, closeSettings } = useNavigation()
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!
  const listRef = useRef<HTMLUListElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pill = useSelectionBox(listRef, '[aria-current="page"]', [current.id])

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={styles.window}
      aria-label="Settings"
      onCancel={(event) => {
        event.preventDefault()
        // Escape in a dialog opened from here (the theme browser) closes only that one.
        if (event.target === dialogRef.current) closeSettings()
      }}
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) closeSettings()
      }}
    >
    <div className={styles.screen}>
      <nav className={styles.nav} aria-label="Settings sections">
        <h1 className={styles.navTitle}>Settings</h1>
        <ul ref={listRef} className={styles.navList}>
          {pill && <li className={styles.navPill} aria-hidden style={pill} />}
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={cx(styles.navItem, s.id === current.id && styles.navActive)}
                aria-current={s.id === current.id ? 'page' : undefined}
                onClick={() => openSettings(s.id)}
              >
                {s.icon}
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className={styles.content} aria-label={current.label}>
        <IconButton label="Close settings" icon={<X />} onClick={closeSettings} className={styles.close} />
        <ErrorBoundary key={current.id} region={current.label} resetKey={current.id}>
          {current.id === 'appearance' && <AppearanceSection />}
          {current.id === 'agents' && <AgentsSection />}
          {current.id === 'browser' && <BrowserSection />}
          {current.id === 'extensions' && <ExtensionsSection />}
          {current.id === 'integrations' && <IntegrationsSection />}
          {current.id === 'queen' && <QueenSection />}
          {current.id === 'remote' && <RemoteSection />}
          {current.id === 'updates' && <UpdatesSection />}
          {current.id === 'guide' && <GuideSection />}
          {current.id === 'about' && <AboutSection />}
        </ErrorBoundary>
      </section>
    </div>
    </dialog>
  )
}

/** Shared section scaffolding. */
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
