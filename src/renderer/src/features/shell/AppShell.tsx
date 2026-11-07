import { lazy, Suspense, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { ResizeHandle } from '../../components/ui/ResizeHandle'
import { Toasts } from '../../components/ui/Toasts'
import { SshPromptDialog } from './SshPromptDialog'
import { cx } from '../../lib/cx'
import { usePlatform } from '../../lib/platform'
import { useSettings } from '../../stores/data'
import { PANEL_WIDTH, SIDEBAR_WIDTH, useNavigation } from '../../stores/navigation'
import { QueenDock, QueenFloating } from '../queen/Queen'
import { useQueen } from '../queen/useQueen'
import { ProjectSidebar } from '../projects/ProjectSidebar'
import { AddProjectDialog } from '../projects/AddProjectDialog'
import { RoutineEditor } from '../routines/RoutineEditor'
import { useAppShortcuts } from './useAppShortcuts'
import { UpdatePrompt } from '../updates/UpdatePrompt'
import { CreateWorkspaceDialog } from '../workspace-create/CreateWorkspaceDialog'
import { useNewWorktree } from '../workspace-create/new-worktree'
import { SidePanel } from '../side-panel/SidePanel'
import { WorkspaceScreen } from '../workspace/WorkspaceScreen'
import { HomeScreen } from './HomeScreen'
import { SidePanelToggle, SidebarBottom, SidebarRail, SidebarTop, WindowControls } from './SidebarChrome'
import { useWindowControlsRoom } from './window-controls'
import styles from './AppShell.module.css'

/* Loaded when first needed (ADR 0044): a window never parses Settings until it is opened. */
const SettingsScreen = lazy(() => import('../settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))

/**
 * Top-level layout (ADR 0056): no title bar. The sidebar, the main area and the side panel all start
 * at the top of the window; the window's chrome lives in the sidebar (folded, an icon rail).
 * Each region has its own error boundary.
 * Both sidebars are resizable; a maximized side panel overlays the main area
 * (which keeps its size, so agent terminals never reflow).
 */
export function AppShell() {
  const {
    view,
    sidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebar,
    panelOpen,
    panelWidth,
    setPanelWidth,
    togglePanel,
    panelMaximized,
    workMinWidth
  } = useNavigation()
  useAppShortcuts()
  const newWorktree = useNewWorktree()
  const hasWallpaper = useSettings((s) => Boolean(s.settings.wallpaper))
  const queenPlacement = useQueen((s) => s.placement)
  const platform = usePlatform()
  const inSettings = view.type === 'settings'
  // Settings is a window over the app (ADR 0039): everything behind it stays laid out, so changes show live.
  const showSidebar = !sidebarCollapsed
  const workView = view.type === 'settings' ? view.returnTo : view
  // The right column: a worktree's side panel (never on Home).
  const showPanel = panelOpen && workView.type === 'workspace'
  const maximized = panelMaximized
  const viewKey = workView.type === 'home' ? 'home' : `w:${workView.workspaceId}`
  // The open Worktree's panes keep their minimum width: the sidebars give way (see .main).
  const workMin = workView.type === 'workspace' ? workMinWidth : 0
  const widths = {
    // Folded, the sidebar is its icon rail: a fixed column.
    '--sidebar-width': showSidebar ? `${sidebarWidth}px` : 'var(--rail-width)',
    '--sidebar-min': showSidebar ? `${SIDEBAR_WIDTH.min}px` : 'var(--rail-width)',
    '--side-panel-width': `${panelWidth}px`,
    '--side-panel-min': `${PANEL_WIDTH.min}px`,
    '--work-min-width': `${workMin}px`
  } as CSSProperties
  const mainRef = useRef<HTMLDivElement>(null)
  useWindowControlsRoom(mainRef)
  // Rendered widths: a sidebar's handle starts from what is shown (the grid may have narrowed it)
  // and stops where the panes would go below their minimum.
  const sidebarRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState({ sidebar: 0, content: 0, panel: 0 })
  useLayoutEffect(() => {
    const measure = (): void =>
      setShown({
        sidebar: sidebarRef.current?.offsetWidth ?? 0,
        content: contentRef.current?.offsetWidth ?? 0,
        panel: panelRef.current?.offsetWidth ?? 0
      })
    measure()
    const observer = new ResizeObserver(measure)
    for (const el of [sidebarRef.current, contentRef.current, panelRef.current]) if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [showSidebar, showPanel])
  const slack = Math.max(0, shown.content - workMin)
  const sidebarMax = Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, shown.sidebar + slack))
  const panelMax = Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, shown.panel + slack))

  return (
    <div className={cx(styles.app, `platform-${platform}`)}>
      {hasWallpaper && <div className={styles.wallpaper} aria-hidden />}
      <div ref={mainRef} className={cx(styles.main, showPanel && styles.withPanel, showPanel && maximized && styles.covered)} style={widths}>
        {/* Keyed: the full sidebar glides in again whenever it is shown. */}
        <aside key={showSidebar ? 'sidebar' : 'rail'} ref={sidebarRef} className={styles.sidebar}>
          <ErrorBoundary region="Sidebar" compact>
            {showSidebar ? <ProjectSidebar top={<SidebarTop />} bottom={<SidebarBottom />} /> : <SidebarRail />}
          </ErrorBoundary>
          {showSidebar && (
            <ResizeHandle
              label="Resize sidebar"
              className={styles.sidebarHandle}
              value={shown.sidebar || sidebarWidth}
              min={SIDEBAR_WIDTH.min}
              max={sidebarMax}
              initial={SIDEBAR_WIDTH.initial}
              direction={1}
              onChange={(width) => setSidebarWidth(Math.min(width, sidebarMax))}
              onCollapse={toggleSidebar}
            />
          )}
        </aside>
        <main ref={contentRef} className={styles.content}>
          <div className={styles.stage}>
            <div key={viewKey} className={styles.view}>
              <ErrorBoundary region="This screen" resetKey={viewKey}>
                {workView.type === 'workspace' ? (
                  <WorkspaceScreen
                    key={workView.workspaceId}
                    projectId={workView.projectId}
                    workspaceId={workView.workspaceId}
                    focusPaneId={workView.focusPaneId}
                  />
                ) : (
                  <HomeScreen />
                )}
              </ErrorBoundary>
            </div>
          </div>
          <ErrorBoundary region="Queen Bee" compact>
            {queenPlacement === 'docked' ? <QueenDock /> : queenPlacement === 'floating' ? <QueenFloating /> : null}
          </ErrorBoundary>
        </main>
        {showPanel && (
          <div ref={panelRef} className={cx(styles.panel, maximized && styles.panelMaximized)}>
            {!maximized && (
              <ResizeHandle
                label="Resize side panel"
                className={styles.panelHandle}
                value={shown.panel || panelWidth}
                min={PANEL_WIDTH.min}
                max={panelMax}
                initial={PANEL_WIDTH.initial}
                direction={-1}
                onChange={(width) => setPanelWidth(Math.min(width, panelMax))}
                onCollapse={togglePanel}
              />
            )}
            <ErrorBoundary region="Side panel" compact>
              <SidePanel />
            </ErrorBoundary>
          </div>
        )}
        <div className={styles.corner}>
          <SidePanelToggle />
          <WindowControls />
        </div>
      </div>
      {inSettings && (
        <ErrorBoundary region="Settings">
          <Suspense fallback={null}>
            <SettingsScreen section={view.section} />
          </Suspense>
        </ErrorBoundary>
      )}
      <AddProjectDialog />
      {/* Opened from a worktree's menu and its Schedules tab (ADR 0040). */}
      <RoutineEditor />
      <SshPromptDialog />
      {newWorktree.projectId && <CreateWorkspaceDialog projectId={newWorktree.projectId} onClose={newWorktree.close} />}
      <UpdatePrompt />
      <Toasts />
    </div>
  )
}
