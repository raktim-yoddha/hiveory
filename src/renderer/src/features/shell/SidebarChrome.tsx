import { useShallow } from 'zustand/react/shallow'
import { CalendarClock, PanelLeft, PanelRight, Search, Settings } from 'lucide-react'
import { AppLogo } from '../../components/brand/AppLogo'
import { IconButton } from '../../components/ui/Button'
import { cx } from '../../lib/cx'
import { useApp } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { RailWorkspaces } from '../projects/RailWorkspaces'
import { usePalette } from './palette/palette-store'
import { useCommandKeys } from './useAppShortcuts'
import styles from './SidebarChrome.module.css'

const withKeys = (label: string, keys?: string): string => (keys ? `${label} (${keys})` : label)

/** What the window's chrome buttons need: there is no title bar (ADR 0056), so they live in the sidebar. */
function useChrome() {
  const { sidebarCollapsed, toggleSidebar, panelOpen, togglePanel, view, openSettings, closeSettings, openSchedules } = useNavigation(useShallow((s) => ({ sidebarCollapsed: s.sidebarCollapsed, toggleSidebar: s.toggleSidebar, panelOpen: s.panelOpen, togglePanel: s.togglePanel, view: s.view, openSettings: s.openSettings, closeSettings: s.closeSettings, openSchedules: s.openSchedules })))
  const inSettings = view.type === 'settings'
  const keys = { sidebar: useCommandKeys('toggle-sidebar'), panel: useCommandKeys('toggle-side-panel'), settings: useCommandKeys('open-settings'), find: useCommandKeys('command-palette'), schedules: useCommandKeys('open-schedules') }
  const sidebarLabel = sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'
  const panelLabel = panelOpen ? 'Hide side panel' : 'Show side panel'
  const settingsLabel = inSettings ? 'Close settings' : 'Settings'
  const inSchedules = view.type === 'schedules'
  return {
    inSchedules,
    openSchedules,
    schedulesTitle: withKeys('Schedules', keys.schedules),
    // The command palette (ADR 0060).
    find: <IconButton label="Find" title={withKeys('Find a command, worktree or setting', keys.find)} icon={<Search />} onClick={() => usePalette.getState().toggle()} className={styles.noDrag} />,
    sidebar: <IconButton label={sidebarLabel} title={withKeys(sidebarLabel, keys.sidebar)} icon={<PanelLeft />} active={!sidebarCollapsed} onClick={toggleSidebar} className={styles.noDrag} />,
    // The side panel belongs to worktrees only (ADR 0021).
    panel: (inSettings ? view.returnTo : view).type === 'workspace' && (
      <IconButton label={panelLabel} title={withKeys(panelLabel, keys.panel)} icon={<PanelRight />} active={panelOpen} onClick={togglePanel} className={styles.noDrag} />
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

/** The sidebar's top bar: brand and the sidebar button. It drags the window. */
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
      {chrome.sidebar}
    </div>
  )
}

/** Schedules, above the Workspaces (ADR 0062): every Workspace's schedules in the main area. */
export function SidebarSchedules() {
  const chrome = useChrome()
  return (
    <div className={styles.links}>
      <button
        type="button"
        className={cx(styles.link, chrome.inSchedules && styles.linkActive)}
        aria-current={chrome.inSchedules ? 'page' : undefined}
        title={chrome.schedulesTitle}
        onClick={chrome.openSchedules}
      >
        <CalendarClock aria-hidden />
        Schedules
      </button>
    </div>
  )
}

/** The side panel's button sits on the right, over the top-right top bar (ADR 0056); only in a worktree. */
export function SidePanelToggle() {
  return useChrome().panel || null
}

/** The sidebar's footer: app settings. */
export function SidebarBottom() {
  const chrome = useChrome()
  return (
    <div className={styles.bottom}>
      {chrome.settings}
      {chrome.find}
    </div>
  )
}

/** The sidebar folded away: the same buttons as an icon rail, plus every Workspace's mark, so nothing is out of reach. */
export function SidebarRail() {
  const chrome = useChrome()
  return (
    <nav className={styles.rail} aria-label="App">
      {chrome.sidebar}
      <IconButton label="Schedules" title={chrome.schedulesTitle} icon={<CalendarClock />} active={chrome.inSchedules} onClick={chrome.openSchedules} className={styles.noDrag} />
      <RailWorkspaces />
      {chrome.find}
      {chrome.settings}
    </nav>
  )
}
