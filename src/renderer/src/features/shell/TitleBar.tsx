import { PanelLeft } from 'lucide-react'
import { AppLogo } from '../../components/brand/AppLogo'
import { IconButton } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { useApp } from '../../stores/data'
import { useNavigation, type AppMode } from '../../stores/navigation'
import styles from './TitleBar.module.css'

const MODES: Array<{ value: AppMode; label: string }> = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'chatspace', label: 'Chatspace' }
]

/** Frameless title bar: brand, sidebar toggle and the two top-level modes (design.md). */
export function TitleBar() {
  const platform = useApp((s) => s.info?.platform)
  const { mode, setMode, sidebarCollapsed, toggleSidebar } = useNavigation()
  return (
    <header className={styles.bar} data-platform={platform}>
      <div className={styles.start}>
        <span className={styles.brand}>
          <AppLogo />
          <span className={styles.name}>Hiveory</span>
        </span>
        <IconButton
          label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          icon={<PanelLeft />}
          onClick={toggleSidebar}
          className={styles.noDrag}
        />
      </div>
      <Tabs label="Mode" variant="segmented" options={MODES} value={mode} onChange={setMode} className={styles.noDrag} />
      <div className={styles.end} />
    </header>
  )
}
