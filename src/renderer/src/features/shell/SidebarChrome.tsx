import { PanelLeft, PanelRight, Settings } from 'lucide-react'
import { AppLogo } from '../../components/brand/AppLogo'
import { IconButton } from '../../components/ui/Button'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { useApp } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { RailWorkspaces } from '../projects/RailWorkspaces'
import { QueenTitle } from '../queen/Queen'
import { useQueen } from '../queen/useQueen'
import { useCommandKeys } from './useAppShortcuts'
import styles from './SidebarChrome.module.css'

const withKeys = (label: string, keys?: string): string => (keys ? `${label} (${keys})` : label)

/** What the window's chrome buttons need: there is no title bar (ADR 0056), so they live in the sidebar. */
function useChrome() {
  const { sidebarCollapsed, toggleSidebar, panelOpen, togglePanel, view, openSettings, closeSettings } = useNavigation()
  const inSettings = view.type === 'settings'
  const keys = { sidebar: useCommandKeys('toggle-sidebar'), panel: useCommandKeys('toggle-side-panel'), settings: useCommandKeys('open-settings') }
  const sidebarLabel = sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'
  const panelLabel = panelOpen ? 'Hide side panel' : 'Show side panel'
  const settingsLabel = inSettings ? 'Close settings' : 'Settings'
  return {
    sidebar: <IconButton label={sidebarLabel} title={withKeys(sidebarLabel, keys.sidebar)} icon={<PanelLeft />} active={!sidebarCollapsed} onClick={toggleSidebar} className={styles.noDrag} />,
    // The side panel belongs to worktrees only (ADR 0021).
    panel: (inSettings ? view.returnTo : view).type === 'workspace' && (
      <IconButton label={panelLabel} title={withKeys(panelLabel, keys.panel)} icon={<PanelRight />} active={panelOpen} onClick={togglePanel} className={styles.noDrag} />
    ),
    // Queen Bee put away (ADR 0044): her mark beside the layout buttons.
    queen: useQueen((s) => s.placement) === 'titlebar' && (
      <ErrorBoundary region="Queen Bee" compact>
        <QueenTitle />
      </ErrorBoundary>
    ),
    settings: (
      <IconButton
        label={settingsLabel}
        title={withKeys(settingsLabel, keys.settings)}
        icon={<Settings />}
        active={inSettings}
        onClick={() => (inSettings ? closeSettings() : openSettings())}
        className={styles.noDrag}
      />
    )
  }
}

/** The sidebar's top bar: brand, Queen Bee's mark when put away, and the sidebar button. It drags the window. */
export function SidebarTop() {
  const info = useApp((s) => s.info)
  const chrome = useChrome()
  return (
    <div className={styles.top}>
      <span className={styles.brand}>
        <AppLogo />
        <span className={styles.name}>Hiveory</span>
        {info?.client && (
          <span className={styles.dev} title={`This window uses the Hiveory server ${info.client.server}`}>
            SERVER
          </span>
        )}
        {info?.isDev && (
          <span className={styles.dev} title="Development build">
            DEV
          </span>
        )}
      </span>
      {chrome.queen}
      {chrome.sidebar}
    </div>
  )
}

/** The side panel's button sits on the right, over the top-right top bar (ADR 0056); only in a worktree. */
export function SidePanelToggle() {
  return useChrome().panel || null
}

/** The sidebar's footer: app settings. */
export function SidebarBottom() {
  return <div className={styles.bottom}>{useChrome().settings}</div>
}

/** The sidebar folded away: the same buttons as an icon rail, plus every Workspace's mark, so nothing is out of reach. */
export function SidebarRail() {
  const chrome = useChrome()
  return (
    <nav className={styles.rail} aria-label="App">
      {chrome.sidebar}
      {chrome.queen}
      <RailWorkspaces />
      {chrome.settings}
    </nav>
  )
}
