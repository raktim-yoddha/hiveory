import { PanelLeft, PanelRight, Settings } from 'lucide-react'
import { AppLogo } from '../../components/brand/AppLogo'
import { IconButton } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { useApp } from '../../stores/data'
import { useNavigation, type AppMode } from '../../stores/navigation'
import styles from './TitleBar.module.css'

const MODES: Array<{ value: AppMode; label: string }> = [
  { value: 'workspace', label: 'Work' },
  { value: 'chatspace', label: 'Chat' }
]

/** Frameless title bar: brand, panel toggles, the two top-level modes and app settings (design.md). */
export function TitleBar() {
  const info = useApp((s) => s.info)
  const { mode, setMode, sidebarCollapsed, toggleSidebar, panelOpen, togglePanel, view, openSettings, closeSettings } = useNavigation()
  const inSettings = view.type === 'settings'
  return (
    <header className={styles.bar} data-platform={info?.platform}>
      <div className={styles.start}>
        <span className={styles.brand}>
          <AppLogo />
          <span className={styles.name}>Hiveory</span>
          {info?.isDev && (
            <span className={styles.dev} title="Development build">
              DEV
            </span>
          )}
        </span>
        {/* Nudges a little right while the sidebar is open, a little left while it is closed. */}
        <span className={styles.sidebarToggle} data-open={!sidebarCollapsed && !inSettings}>
          <IconButton
            label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            icon={<PanelLeft />}
            active={!sidebarCollapsed && !inSettings}
            onClick={toggleSidebar}
            className={styles.noDrag}
          />
        </span>
      </div>
      <Tabs label="Mode" variant="segmented" options={MODES} value={mode} onChange={setMode} className={styles.noDrag} />
      <div className={styles.end}>
        <IconButton
          label={panelOpen ? 'Hide side panel' : 'Show side panel'}
          icon={<PanelRight />}
          active={panelOpen && !inSettings}
          onClick={togglePanel}
          className={styles.noDrag}
        />
        <IconButton
          label={inSettings ? 'Close settings' : 'Settings'}
          icon={<Settings />}
          active={inSettings}
          onClick={() => (inSettings ? closeSettings() : openSettings())}
          className={styles.noDrag}
        />
      </div>
    </header>
  )
}
