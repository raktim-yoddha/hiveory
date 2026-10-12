import { PanelLeft, PanelRight, Settings } from 'lucide-react'
import { AppLogo } from '../../components/brand/AppLogo'
import { IconButton } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { useApp } from '../../stores/data'
import { useNavigation, type AppMode } from '../../stores/navigation'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { QueenTitle } from '../queen/Queen'
import { useQueen } from '../queen/useQueen'
import { useCommandKeys } from './useAppShortcuts'
import styles from './TitleBar.module.css'

const MODES: Array<{ value: AppMode; label: string }> = [
  { value: 'workspace', label: 'Work' },
  { value: 'bots', label: 'Bots' },
  { value: 'chatspace', label: 'Chat' }
]

/** Frameless title bar: brand, panel toggles, the three top-level modes and app settings (design.md). */
export function TitleBar() {
  const info = useApp((s) => s.info)
  const { mode, setMode, sidebarCollapsed, toggleSidebar, panelOpen, togglePanel, view, openSettings, closeSettings } = useNavigation()
  const inSettings = view.type === 'settings'
  const queenInTitle = useQueen((s) => s.placement) === 'titlebar'
  const keys = { sidebar: useCommandKeys('toggle-sidebar'), panel: useCommandKeys('toggle-side-panel'), settings: useCommandKeys('open-settings') }
  const withKeys = (label: string, k?: string): string => (k ? `${label} (${k})` : label)
  return (
    <header className={styles.bar} data-platform={info?.platform}>
      <div className={styles.start}>
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
        <span className={styles.sidebarToggle}>
          <IconButton
            label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            title={withKeys(sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar', keys.sidebar)}
            icon={<PanelLeft />}
            active={!sidebarCollapsed}
            onClick={toggleSidebar}
            className={styles.noDrag}
          />
        </span>
      </div>
      <Tabs label="Mode" variant="segmented" options={MODES} value={mode} onChange={setMode} className={styles.noDrag} />
      <div className={styles.end}>
        {/* The side panel belongs to workspaces only (ADR 0021). */}
        {mode === 'workspace' && (view.type === 'settings' ? view.returnTo : view).type === 'workspace' && (
          <IconButton
            label={panelOpen ? 'Hide side panel' : 'Show side panel'}
            title={withKeys(panelOpen ? 'Hide side panel' : 'Show side panel', keys.panel)}
            icon={<PanelRight />}
            active={panelOpen}
            onClick={togglePanel}
            className={styles.noDrag}
          />
        )}
        {/* Queen Bee put away (ADR 0044): her mark after the side panel button. */}
        {queenInTitle && (
          <ErrorBoundary region="Queen Bee" compact>
            <QueenTitle />
          </ErrorBoundary>
        )}
        <IconButton
          label={inSettings ? 'Close settings' : 'Settings'}
          title={withKeys(inSettings ? 'Close settings' : 'Settings', keys.settings)}
          icon={<Settings />}
          active={inSettings}
          onClick={() => (inSettings ? closeSettings() : openSettings())}
          className={styles.noDrag}
        />
      </div>
    </header>
  )
}
