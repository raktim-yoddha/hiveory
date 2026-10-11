import { useEffect, type ReactNode } from 'react'
import { CircleDot, FolderGit2, GitBranch, KanbanSquare } from 'lucide-react'
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
import { IssuesTab } from './IssuesTab'
import { WorkspacesTab } from './WorkspacesTab'
import styles from './ProjectScreen.module.css'

// Routines and Settings are side-panel tabs of their own (ADR 0042).
const TABS: Array<{ value: ProjectTab; label: string; icon: ReactNode }> = [
  { value: 'tasks', label: 'Tasks', icon: <KanbanSquare /> },
  { value: 'workspaces', label: 'Worktrees', icon: <GitBranch /> },
  { value: 'issues', label: 'Issues', icon: <CircleDot /> }
]

const REGION: Record<ProjectTab, string> = {
  tasks: 'Kanban board',
  workspaces: 'Worktrees and reviews',
  issues: 'Issues'
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
        <Tabs label="Workspace sections" options={TABS} value={tab} onChange={setTab} iconsWhenNarrow />
      </div>
      <div className={styles.content} role="tabpanel" aria-label={REGION[tab]}>
        <ErrorBoundary region={REGION[tab]} resetKey={`${projectId}:${tab}`}>
          {tab === 'tasks' && <KanbanBoard projectId={projectId} workspaceId={workspaceId} />}
          {tab === 'workspaces' && <WorkspacesTab projectId={projectId} />}
          {tab === 'issues' && <IssuesTab projectId={projectId} local={!project.host && Boolean(project.repositoryRoot)} />}
        </ErrorBoundary>
      </div>
    </section>
  )
}
