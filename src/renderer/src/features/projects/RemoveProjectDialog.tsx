import type { Project } from '@shared/domain'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { api } from '../../lib/api'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'

/** Removes a project from Hiveory (its agents stop); nothing on disk is deleted. */
export function RemoveProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const remove = (): void =>
    void runAction('Remove project', async () => {
      await api('projects.remove', { projectId: project.id })
      const nav = useNavigation.getState()
      if (selectedProjectId(nav.view) === project.id) nav.goHome()
      onClose()
    })

  return (
    <ConfirmDialog open danger title={`Remove ${project.name}?`} confirmLabel="Remove project" onConfirm={remove} onClose={onClose}>
      <p>Its agents will stop and it will disappear from the sidebar. Nothing is deleted from disk.</p>
    </ConfirmDialog>
  )
}
