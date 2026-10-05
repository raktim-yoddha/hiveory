import { useLayoutEffect, useRef, useState } from 'react'
import { PanelLeft, PanelRight, Settings } from 'lucide-react'
import { AppLogo } from '../../components/brand/AppLogo'
import { IconButton } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { useApp } from '../../stores/data'
import { useNavigation, type AppMode } from '../../stores/navigation'
import { cx } from '../../lib/cx'
import styles from './TitleBar.module.css'

const MODES: Array<{ value: AppMode; label: string }> = [
  { value: 'workspace', label: 'Work' },
  { value: 'chatspace', label: 'Chat' }
]

/** Frameless title bar: brand, panel toggles, the two top-level modes and app settings (design.md). */
export function TitleBar() {
  const info = useApp((s) => s.info)
  const { mode, setMode, sidebarCollapsed, toggleSidebar, panelOpen, togglePanel, panelWidth, panelMaximized, view, openSettings, closeSettings } = useNavigation()
  const inSettings = view.type === 'settings'
  const shift = usePanelToggleShift(panelOpen && !inSettings, panelWidth, panelMaximized)
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
          active={!sidebarCollapsed && !inSettings}
          onClick={toggleSidebar}
          className={styles.noDrag}
        />
      </div>
      <Tabs label="Mode" variant="segmented" options={MODES} value={mode} onChange={setMode} className={styles.noDrag} />
      <div className={styles.end}>
        {/* Open, the toggle slides over to the panel's left edge, so it reads as part of the panel (like the left one). */}
        <span ref={shift.ref} className={cx(styles.panelToggle, styles.noDrag)} style={{ transform: shift.x ? `translateX(${shift.x}px)` : undefined }}>
          <IconButton label={panelOpen ? 'Hide side panel' : 'Show side panel'} icon={<PanelRight />} active={panelOpen && !inSettings} onClick={togglePanel} />
        </span>
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

/** How far the side-panel toggle moves left to sit at the open panel's left edge (0 when closed). */
function usePanelToggleShift(docked: boolean, panelWidth: number, maximized: boolean) {
  const ref = useRef<HTMLSpanElement>(null)
  const [x, setX] = useState(0)
  const current = useRef(0)
  useLayoutEffect(() => {
    const place = (): void => {
      const el = ref.current
      const panel = document.querySelector('[data-panel-column]')?.getBoundingClientRect()
      // Never over the Work/Chat switch: a wide or maximized panel stops it just right of it.
      const modes = el?.closest('header')?.children[1]?.getBoundingClientRect()
      const target = panel && modes ? Math.max(panel.left, modes.right + 8) : panel?.left
      const next = docked && el && target !== undefined ? Math.min(0, Math.round(target - (el.getBoundingClientRect().left - current.current))) : 0
      current.current = next
      setX(next)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [docked, panelWidth, maximized])
  return { ref, x }
}
