import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { Toasts } from '../../components/ui/Toasts'
import { cx } from '../../lib/cx'
import { useNavigation } from '../../stores/navigation'
import { ChatspaceScreen } from '../chatspace/ChatspaceScreen'
import { ProjectScreen } from '../project/ProjectScreen'
import { ProjectSidebar } from '../projects/ProjectSidebar'
import { WorkspaceScreen } from '../workspace/WorkspaceScreen'
import { HomeScreen } from './HomeScreen'
import { TitleBar } from './TitleBar'
import styles from './AppShell.module.css'

/** Top-level layout. Each region has its own error boundary so one failure never blanks the app. */
export function AppShell() {
  const { mode, view, sidebarCollapsed } = useNavigation()
  const showSidebar = mode === 'workspace' && !sidebarCollapsed
  const viewKey = view.type === 'home' ? 'home' : view.type === 'project' ? `p:${view.projectId}` : `w:${view.workspaceId}`

  return (
    <div className={styles.app}>
      <ErrorBoundary region="Title bar" compact>
        <TitleBar />
      </ErrorBoundary>
      <div className={cx(styles.main, showSidebar && styles.withSidebar)}>
        {showSidebar && (
          <aside className={styles.sidebar}>
            <ErrorBoundary region="Sidebar" compact>
              <ProjectSidebar />
            </ErrorBoundary>
          </aside>
        )}
        <main className={styles.content}>
          <ErrorBoundary region="This screen" resetKey={`${mode}:${viewKey}`}>
            {mode === 'chatspace' ? (
              <ChatspaceScreen />
            ) : view.type === 'project' ? (
              <ProjectScreen projectId={view.projectId} tab={view.tab} />
            ) : view.type === 'workspace' ? (
              <WorkspaceScreen
                key={view.workspaceId}
                projectId={view.projectId}
                workspaceId={view.workspaceId}
                focusPaneId={view.focusPaneId}
              />
            ) : (
              <HomeScreen />
            )}
          </ErrorBoundary>
        </main>
      </div>
      <Toasts />
    </div>
  )
}
