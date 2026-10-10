import { useEffect } from 'react'
import { FolderGit2 } from 'lucide-react'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { PathTrail } from '../../components/ui/PathTrail'
import { HostBadge } from '../../components/ui/HostBadge'
import { Tabs } from '../../components/ui/Tabs'
import { api } from '../../lib/api'
import { useProjects } from '../../stores/data'
import { useNavigation, type ProjectTab } from '../../stores/navigation'
import { KanbanBoard } from '../kanban/KanbanBoard'
import { WorkspaceMark } from '../projects/WorkspaceMark'
import { PortsMenu } from './PortsMenu'
import { ProjectSettingsTab } from './ProjectSettingsTab'
import { PullRequestsTab } from './PullRequestsTab'
import { WorkspacesTab } from './WorkspacesTab'
import styles from './ProjectScreen.module.css'

const TABS: Array<{ value: ProjectTab; label: string }> = [
  { value: 'tasks', label: 'Tasks' },
  { value: 'pull-requests', label: 'Pull Requests' },
  { value: 'workspaces', label: 'Worktrees' },
  { value: 'settings', label: 'Settings' }
]

const REGION: Record<ProjectTab, string> = {
  tasks: 'Kanban board',
  'pull-requests': 'Pull requests',
  workspaces: 'Worktrees',
  settings: 'Workspace settings'
}

/**
 * The Workspace page, a tab of the side panel beside the open Worktree (ADR 0038). It never offers
 * "Open agent" or "Load preset" — those belong to an empty Worktree (AGENTS.md rule 11) — and new
 * worktrees come from the sidebar's "+".
 */
export function ProjectScreen({ projectId, workspaceId }: { projectId: string; workspaceId: string }) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId))
  const tab = useNavigation((s) => s.workspaceTab)
  const setTab = useNavigation((s) => s.setWorkspaceTab)

  useEffect(() => {
    void api('projects.touch', { projectId }).catch(() => undefined)
  }, [projectId])

  if (!project) return <EmptyState compact icon={<FolderGit2 />} title="Workspace not found" description="It may have been removed." />

  return (
    <section className={styles.screen} aria-label={project.name}>
      <header className={styles.header}>
        <WorkspaceMark project={project} className={styles.headerMark} />
        <div className={styles.titles}>
          <h2 className={styles.title}>
            {project.name} <HostBadge host={project.host} />
          </h2>
          <PathTrail path={project.path} reveal={project.host ? undefined : { projectId }} />
        </div>
        {project.host && <PortsMenu projectId={projectId} host={project.host.destination} />}
      </header>
      <div className={styles.tabs}>
        <Tabs label="Workspace sections" options={TABS} value={tab} onChange={setTab} />
      </div>
      <div className={styles.content} role="tabpanel" aria-label={REGION[tab]}>
        <ErrorBoundary region={REGION[tab]} resetKey={`${projectId}:${tab}`}>
          {tab === 'tasks' && <KanbanBoard projectId={projectId} workspaceId={workspaceId} />}
          {tab === 'pull-requests' && <PullRequestsTab projectId={projectId} />}
          {tab === 'workspaces' && <WorkspacesTab projectId={projectId} />}
          {tab === 'settings' && <ProjectSettingsTab project={project} />}
        </ErrorBoundary>
      </div>
    </section>
  )
}
