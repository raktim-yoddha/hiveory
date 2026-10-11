import { FolderGit2 } from 'lucide-react'
import { EmptyState } from '../../components/ui/EmptyState'
import { useProjects } from '../../stores/data'
import { ProjectSettingsTab } from './ProjectSettingsTab'
import { WorkRoutinesTab } from './WorkRoutinesTab'
import styles from './ProjectScreen.module.css'

/** A Workspace's Routines or Settings as a side-panel tab of its own, beside the Dashboard (ADR 0042). */
export function ProjectPanel({ kind, projectId, workspaceId }: { kind: 'routines' | 'settings'; projectId: string; workspaceId: string }) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId))
  if (!project) return <EmptyState compact icon={<FolderGit2 />} title="Workspace not found" description="It may have been removed." />
  return (
    <section className={styles.screen} aria-label={`${project.name} ${kind === 'routines' ? 'routines' : 'settings'}`}>
      <div className={styles.content}>{kind === 'routines' ? <WorkRoutinesTab projectId={projectId} workspaceId={workspaceId} /> : <ProjectSettingsTab project={project} />}</div>
    </section>
  )
}
