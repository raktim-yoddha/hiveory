import { FolderGit2 } from 'lucide-react'
import { EmptyState } from '../../components/ui/EmptyState'
import { useProjects } from '../../stores/data'
import { ProjectSettingsTab } from './ProjectSettingsTab'
import { RoutinesPage } from '../routines/RoutinesPage'
import styles from './ProjectScreen.module.css'

/** A Workspace's Schedules (calendar, list and run log, ADR 0055) or Settings as a side-panel tab of its own (ADR 0042). */
export function ProjectPanel({ kind, projectId, workspaceId }: { kind: 'routines' | 'settings'; projectId: string; workspaceId: string }) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId))
  if (!project) return <EmptyState compact icon={<FolderGit2 />} title="Workspace not found" description="It may have been removed." />
  return (
    <section className={styles.screen} aria-label={`${project.name} ${kind === 'routines' ? 'schedules' : 'settings'}`}>
      <div className={styles.content}>{kind === 'routines' ? <RoutinesPage scope={{ projectId, workspaceId }} /> : <ProjectSettingsTab project={project} />}</div>
    </section>
  )
}
