import type { CSSProperties } from 'react'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { ResizeHandle } from '../../components/ui/ResizeHandle'
import { Toasts } from '../../components/ui/Toasts'
import { SshPromptDialog } from './SshPromptDialog'
import { cx } from '../../lib/cx'
import { useSettings } from '../../stores/data'
import { PANEL_WIDTH, SIDEBAR_WIDTH, useNavigation } from '../../stores/navigation'
import { BotsScreen } from '../bots/BotsScreen'
import { BotsSidebar } from '../bots/BotsSidebar'
import { ChatScreen } from '../chat/ChatScreen'
import { ChatSidebar } from '../chat/ChatSidebar'
import { ProjectScreen } from '../project/ProjectScreen'
import { QueenDock, QueenFloating } from '../queen/Queen'
import { useQueen } from '../queen/useQueen'
import { ProjectSidebar } from '../projects/ProjectSidebar'
import { AddProjectDialog } from '../projects/AddProjectDialog'
import { SettingsScreen } from '../settings/SettingsScreen'
import { SidePanel } from '../side-panel/SidePanel'
import { WorkspaceScreen } from '../workspace/WorkspaceScreen'
import { HomeScreen } from './HomeScreen'
import { TitleBar } from './TitleBar'
import styles from './AppShell.module.css'

/**
 * Top-level layout. Work, Bots and Chat all stay mounted — switching modes only
 * hides the others — so none ever "sleeps". Each region has its own error boundary.
 * Both sidebars are resizable; a maximized side panel overlays the main area
 * (which keeps its size, so agent terminals never reflow).
 */
export function AppShell() {
  const {
    mode,
    view,
    sidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebar,
    panelOpen,
    panelWidth,
    setPanelWidth,
    togglePanel,
    panelMaximized
  } = useNavigation()
  const hasWallpaper = useSettings((s) => Boolean(s.settings.wallpaper))
  const queenPlacement = useQueen((s) => s.placement)
  const inSettings = view.type === 'settings'
  const showSidebar = !inSettings && !sidebarCollapsed
  // The side panel belongs to workspaces only: never on Home, a project page or Settings.
  const showPanel = panelOpen && mode === 'workspace' && view.type === 'workspace'
  const workView = view.type === 'settings' ? view.returnTo : view
  const viewKey = workView.type === 'home' ? 'home' : workView.type === 'project' ? `p:${workView.projectId}` : `w:${workView.workspaceId}`
  const widths = { '--sidebar-width': `${sidebarWidth}px`, '--side-panel-width': `${panelWidth}px` } as CSSProperties

  return (
    <div className={styles.app}>
      {hasWallpaper && <div className={styles.wallpaper} aria-hidden />}
      <ErrorBoundary region="Title bar" compact>
        <TitleBar />
      </ErrorBoundary>
      <div className={cx(styles.main, showSidebar && styles.withSidebar, showPanel && styles.withPanel, showPanel && panelMaximized && styles.covered)} style={widths}>
        {showSidebar && (
          <aside className={styles.sidebar}>
            <ErrorBoundary region="Sidebar" compact>
              {mode === 'chatspace' ? <ChatSidebar /> : mode === 'bots' ? <BotsSidebar /> : <ProjectSidebar />}
            </ErrorBoundary>
            <ResizeHandle
              label="Resize sidebar"
              className={styles.sidebarHandle}
              value={sidebarWidth}
              min={SIDEBAR_WIDTH.min}
              max={SIDEBAR_WIDTH.max}
              initial={SIDEBAR_WIDTH.initial}
              direction={1}
              onChange={setSidebarWidth}
              onCollapse={toggleSidebar}
            />
          </aside>
        )}
        <main className={styles.content}>
          <div className={styles.stage}>
          {inSettings && (
            <ErrorBoundary region="Settings">
              <SettingsScreen section={view.section} />
            </ErrorBoundary>
          )}
          <div className={styles.mode} hidden={inSettings || mode !== 'workspace'}>
            <div key={viewKey} className={styles.view}>
              <ErrorBoundary region="This screen" resetKey={viewKey}>
              {workView.type === 'project' ? (
                <ProjectScreen projectId={workView.projectId} tab={workView.tab} />
              ) : workView.type === 'workspace' ? (
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
          <div className={styles.mode} hidden={inSettings || mode !== 'bots'}>
            <ErrorBoundary region="Bots">
              <BotsScreen />
            </ErrorBoundary>
          </div>
          <div className={styles.mode} hidden={inSettings || mode !== 'chatspace'}>
            <ErrorBoundary region="Chat">
              <ChatScreen />
            </ErrorBoundary>
          </div>
          </div>
          <ErrorBoundary region="Queen Bee" compact>
            {queenPlacement === 'docked' ? <QueenDock /> : <QueenFloating />}
          </ErrorBoundary>
        </main>
        {showPanel && (
          <div className={cx(styles.panel, panelMaximized && styles.panelMaximized)}>
            {!panelMaximized && (
              <ResizeHandle
                label="Resize side panel"
                className={styles.panelHandle}
                value={panelWidth}
                min={PANEL_WIDTH.min}
                max={PANEL_WIDTH.max}
                initial={PANEL_WIDTH.initial}
                direction={-1}
                onChange={setPanelWidth}
                onCollapse={togglePanel}
              />
            )}
            <ErrorBoundary region="Side panel" compact>
              <SidePanel />
            </ErrorBoundary>
          </div>
        )}
      </div>
      <AddProjectDialog />
      <SshPromptDialog />
      <Toasts />
    </div>
  )
}
