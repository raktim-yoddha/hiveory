import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { Toasts } from '../../components/ui/Toasts'
import { cx } from '../../lib/cx'
import { useNavigation } from '../../stores/navigation'
import { ChatScreen } from '../chat/ChatScreen'
import { ChatSidebar } from '../chat/ChatSidebar'
import { ProjectScreen } from '../project/ProjectScreen'
import { ProjectSidebar } from '../projects/ProjectSidebar'
import { SettingsScreen } from '../settings/SettingsScreen'
import { SidePanel } from '../side-panel/SidePanel'
import { WorkspaceScreen } from '../workspace/WorkspaceScreen'
import { HomeScreen } from './HomeScreen'
import { TitleBar } from './TitleBar'
import styles from './AppShell.module.css'

/**
 * Top-level layout. Work and Chat both stay mounted — switching modes only
 * hides one — so neither ever "sleeps". Each region has its own error boundary.
 */
export function AppShell() {
  const { mode, view, sidebarCollapsed, rightPanel } = useNavigation()
  const inSettings = view.type === 'settings'
  const showSidebar = !inSettings && !sidebarCollapsed
  const showPanel = Boolean(rightPanel) && !inSettings
  const workView = view.type === 'settings' ? view.returnTo : view
  const viewKey = workView.type === 'home' ? 'home' : workView.type === 'project' ? `p:${workView.projectId}` : `w:${workView.workspaceId}`

  return (
    <div className={styles.app}>
      <ErrorBoundary region="Title bar" compact>
        <TitleBar />
      </ErrorBoundary>
      <div className={cx(styles.main, showSidebar && styles.withSidebar, showPanel && styles.withPanel)}>
        {showSidebar && (
          <aside className={styles.sidebar}>
            <ErrorBoundary region="Sidebar" compact>
              {mode === 'chatspace' ? <ChatSidebar /> : <ProjectSidebar />}
            </ErrorBoundary>
          </aside>
        )}
        <main className={styles.content}>
          {inSettings && (
            <ErrorBoundary region="Settings">
              <SettingsScreen section={view.section} />
            </ErrorBoundary>
          )}
          <div className={styles.mode} hidden={inSettings || mode !== 'workspace'}>
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
          <div className={styles.mode} hidden={inSettings || mode !== 'chatspace'}>
            <ErrorBoundary region="Chat">
              <ChatScreen />
            </ErrorBoundary>
          </div>
        </main>
        {showPanel && rightPanel && (
          <div className={styles.panel}>
            <SidePanel panel={rightPanel} />
          </div>
        )}
      </div>
      <Toasts />
    </div>
  )
}
