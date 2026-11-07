import { useEffect, useState } from 'react'
import { Copy, Minus, PanelLeft, PanelRight, Settings, Square, X } from 'lucide-react'
import { AppLogo } from '../../components/brand/AppLogo'
import { IconButton } from '../../components/ui/Button'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { api } from '../../lib/api'
import { usePlatform } from '../../lib/platform'
import { useApp } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
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

/**
 * Windows and Linux: the app's own window buttons, sized like every other top-bar button (ADR 0056).
 * macOS keeps its traffic lights. The maximize icon follows the window, however it was resized.
 */
export function WindowControls() {
  const platform = usePlatform()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    if (platform === 'darwin') return
    const sync = (): void => void api('window.control', 'status').then((s) => setMaximized(s.maximized), () => undefined)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [platform])
  if (platform === 'darwin') return null
  const act = (action: 'minimize' | 'maximize' | 'close') => () => void api('window.control', action).then((s) => setMaximized(s.maximized), () => undefined)
  return (
    <span className={styles.windowControls}>
      <IconButton label="Minimize window" icon={<Minus />} onClick={act('minimize')} className={styles.noDrag} />
      <IconButton label={maximized ? 'Restore window' : 'Maximize window'} icon={maximized ? <Copy /> : <Square />} onClick={act('maximize')} className={styles.noDrag} />
      <IconButton label="Close window" icon={<X />} onClick={act('close')} className={`${styles.noDrag} ${styles.closeWindow}`} />
    </span>
  )
}

/** The sidebar's footer: app settings. */
export function SidebarBottom() {
  return <div className={styles.bottom}>{useChrome().settings}</div>
}

/** The sidebar folded away: the same buttons as an icon rail, so nothing is out of reach. */
export function SidebarRail() {
  const chrome = useChrome()
  return (
    <nav className={styles.rail} aria-label="App">
      {chrome.sidebar}
      {chrome.queen}
      <span className={styles.spacer} />
      {chrome.settings}
    </nav>
  )
}
