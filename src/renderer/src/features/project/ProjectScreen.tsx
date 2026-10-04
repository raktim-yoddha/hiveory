import { useEffect } from 'react'
import { FolderGit2 } from 'lucide-react'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { PathTrail } from '../../components/ui/PathTrail'
import { Tabs } from '../../components/ui/Tabs'
import { api } from '../../lib/api'
import { useProjects } from '../../stores/data'
import { useNavigation, type ProjectTab } from '../../stores/navigation'
import { KanbanBoard } from '../kanban/KanbanBoard'
import { ProjectSettingsTab } from './ProjectSettingsTab'
import { PullRequestsTab } from './PullRequestsTab'
import { WorkspacesTab } from './WorkspacesTab'
import styles from './ProjectScreen.module.css'

const TABS: Array<{ value: ProjectTab; label: string }> = [
  { value: 'tasks', label: 'Tasks' },
  { value: 'pull-requests', label: 'Pull Requests' },
  { value: 'workspaces', label: 'Workspaces' },
  { value: 'settings', label: 'Settings' }
]

const REGION: Record<ProjectTab, string> = {
  tasks: 'Kanban board',
  'pull-requests': 'Pull requests',
  workspaces: 'Workspaces',
  settings: 'Project settings'
}

/**
 * Project-level page. It never offers "Open agent" or "Load preset" — those
 * belong to an empty Workspace (AGENTS.md rule 11).
 */
export function ProjectScreen({ projectId, tab }: { projectId: string; tab: ProjectTab }) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId))
  const openProject = useNavigation((s) => s.openProject)

  useEffect(() => {
    void api('projects.touch', { projectId }).catch(() => undefined)
  }, [projectId])

  if (!project) return <EmptyState icon={<FolderGit2 />} title="Project not found" description="It may have been removed." />

  return (
    <section className={styles.screen} aria-label={project.name}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <h1 className={styles.title}>{project.name}</h1>
          <PathTrail path={project.path} reveal={{ projectId }} />
        </div>
      </header>
      <div className={styles.tabs}>
        <Tabs label="Project sections" options={TABS} value={tab} onChange={(next) => openProject(projectId, next)} />
      </div>
      <div className={styles.content} role="tabpanel" aria-label={REGION[tab]}>
        <ErrorBoundary region={REGION[tab]} resetKey={`${projectId}:${tab}`}>
          {tab === 'tasks' && <KanbanBoard projectId={projectId} />}
          {tab === 'pull-requests' && <PullRequestsTab projectId={projectId} />}
          {tab === 'workspaces' && <WorkspacesTab projectId={projectId} />}
          {tab === 'settings' && <ProjectSettingsTab project={project} />}
        </ErrorBoundary>
      </div>
    </section>
  )
}
