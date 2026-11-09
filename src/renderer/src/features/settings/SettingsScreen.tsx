import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { BarChart3, BookOpen, Blocks, Download, FolderGit2, GitPullRequest, Globe, Info, Keyboard, Palette, Server, X } from 'lucide-react'
import { AgentIcon } from '../../components/brand/AgentIcon'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { cx } from '../../lib/cx'
import { useSelectionBox } from '../../lib/useSelectionBox'
import { useProjects } from '../../stores/data'
import { useNavigation, type SettingsSection } from '../../stores/navigation'
import { ProjectSettingsTab } from '../project/ProjectSettingsTab'
import { WorkspaceMark } from '../projects/WorkspaceMark'
import { readSort, sortProjects } from '../projects/project-list'
import { AboutSection } from './AboutSection'
import { SettingsPage } from './SettingsPage'
import { AgentsSection } from './AgentsSection'
import { AppearanceSection } from './AppearanceSection'
import { BrowserSection } from './BrowserSection'
import { ExtensionsSection } from './ExtensionsSection'
import { IntegrationsSection } from './IntegrationsSection'
import { KeyboardSection } from './KeyboardSection'
import { RemoteSection } from './RemoteSection'
import { GuideSection } from './guide/GuideSection'
import { UpdatesSection } from './UpdatesSection'
import { UsageSection } from './UsageSection'
import styles from './Settings.module.css'

const SECTIONS: Array<{ id: Exclude<SettingsSection, 'workspace'>; label: string; icon: ReactNode }> = [
  { id: 'appearance', label: 'Appearance', icon: <Palette /> },
  { id: 'agents', label: 'Agents', icon: <AgentIcon /> },
  { id: 'browser', label: 'Browser', icon: <Globe /> },
  { id: 'extensions', label: 'Skills, MCPs & Apps', icon: <Blocks /> },
  { id: 'integrations', label: 'Integrations', icon: <GitPullRequest /> },
  { id: 'keyboard', label: 'Keyboard', icon: <Keyboard /> },
  { id: 'remote', label: 'Remote', icon: <Server /> },
  { id: 'usage', label: 'Usage', icon: <BarChart3 /> },
  { id: 'updates', label: 'Updates', icon: <Download /> },
  { id: 'guide', label: 'Guide', icon: <BookOpen /> },
  { id: 'about', label: 'About', icon: <Info /> }
]

/**
 * Settings, as a window over the app (ADR 0039): what is behind stays in place, so appearance changes
 * show at once. Escape or × closes it. Under the app's sections, each Workspace's own settings
 * (ADR 0062: a Workspace's right-click › Workspace settings opens its page here).
 */
export function SettingsScreen({ section, projectId }: { section: SettingsSection; projectId?: string }) {
  const { openSettings, closeSettings } = useNavigation(useShallow((s) => ({ openSettings: s.openSettings, closeSettings: s.closeSettings })))
  const projects = useProjects((s) => s.projects)
  const sorted = useMemo(() => sortProjects(projects, readSort()), [projects])
  const project = section === 'workspace' ? projects.find((p) => p.id === projectId) : undefined
  const current =
    section === 'workspace'
      ? { id: `workspace:${projectId ?? ''}`, label: project ? `${project.name} settings` : 'Workspace settings' }
      : (SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!)
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
          {sorted.length > 0 && (
            <li className={styles.navGroup} aria-hidden>
              Workspaces
            </li>
          )}
          {sorted.map((p) => {
            const here = section === 'workspace' && p.id === projectId
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={cx(styles.navItem, here && styles.navActive)}
                  aria-current={here ? 'page' : undefined}
                  aria-label={`${p.name} workspace settings`}
                  onClick={() => openSettings('workspace', p.id)}
                >
                  <WorkspaceMark project={p} className={styles.navMark} />
                  <span className={styles.navText}>{p.name}</span>
                </button>
              </li>
            )
          })}
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
          {current.id === 'keyboard' && <KeyboardSection />}
          {current.id === 'remote' && <RemoteSection />}
          {current.id === 'usage' && <UsageSection />}
          {current.id === 'updates' && <UpdatesSection />}
          {current.id === 'guide' && <GuideSection />}
          {current.id === 'about' && <AboutSection />}
          {section === 'workspace' &&
            (project ? (
              <SettingsPage title={project.name} description="This workspace's own settings. What is left unset follows Settings › Agents.">
                <ProjectSettingsTab project={project} />
              </SettingsPage>
            ) : (
              <EmptyState icon={<FolderGit2 />} title="Workspace not found" description="It may have been removed." />
            ))}
        </ErrorBoundary>
      </section>
    </div>
    </dialog>
  )
}
