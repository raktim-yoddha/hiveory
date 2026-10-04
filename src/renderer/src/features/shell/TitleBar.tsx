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
  const { mode, setMode, sidebarCollapsed, toggleSidebar, rightPanel, toggleRightPanel, view, openSettings, closeSettings } =
    useNavigation()
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
        <IconButton
          label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          icon={<PanelLeft />}
          onClick={toggleSidebar}
          className={styles.noDrag}
        />
      </div>
      <Tabs label="Mode" variant="segmented" options={MODES} value={mode} onChange={setMode} className={styles.noDrag} />
      <div className={styles.end}>
        <IconButton
          label={rightPanel ? 'Hide side panel' : 'Show side panel'}
          icon={<PanelRight />}
          active={Boolean(rightPanel)}
          onClick={() => toggleRightPanel()}
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
