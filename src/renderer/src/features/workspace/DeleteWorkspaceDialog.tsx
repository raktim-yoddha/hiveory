import { useState } from 'react'
import { mainWorkspaceId, type WorkspaceView } from '@shared/domain'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { api, HiveoryError } from '../../lib/api'
import { useProjects } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { reportError, useNotices } from '../../stores/notices'
import { RemoveProjectDialog } from '../projects/RemoveProjectDialog'

interface DeleteWorkspaceDialogProps {
  workspace: WorkspaceView
  onClose: () => void
}

/**
 * Deletes an isolated Worktree. The Primary is the Workspace itself, so removing it removes the
 * Workspace (ADR 0038). For isolated Worktrees, uncommitted changes need a second, explicit
 * confirmation and unmerged branches are always kept.
 */
export function DeleteWorkspaceDialog({ workspace, onClose }: DeleteWorkspaceDialogProps) {
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const view = useNavigation((s) => s.view)
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const isMain = workspace.kind === 'main'
  const project = useProjects((s) => s.projects.find((p) => p.id === workspace.projectId))

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api('workspaces.delete', { workspaceId: workspace.id, force })
      if (view.type === 'workspace' && view.workspaceId === workspace.id) openWorkspace(workspace.projectId, mainWorkspaceId(workspace.projectId))
      if (result.keptBranch) {
        useNotices.getState().push({
          level: 'info',
          message: `Branch ${result.keptBranch} was kept because it has commits that are not merged.`
        })
      }
      onClose()
    } catch (error) {
      if (error instanceof HiveoryError && error.error.code === 'WORKTREE_DIRTY') setForce(true)
      else reportError(error, 'Delete worktree')
    } finally {
      setBusy(false)
    }
  }

  if (isMain) return project ? <RemoveProjectDialog project={project} onClose={onClose} /> : null

  return (
    <ConfirmDialog
      open
      danger
      busy={busy}
      title={force ? 'Discard uncommitted changes?' : `Delete ${workspace.name}?`}
      confirmLabel={force ? 'Delete anyway' : 'Delete worktree'}
      onConfirm={() => void confirm()}
      onClose={onClose}
    >
      {force ? (
        <p>
          <strong>{workspace.name}</strong> has uncommitted changes. Deleting it now permanently discards them.
        </p>
      ) : (
        <p>
          Its agents will stop and its folder will be removed. The branch{' '}
          <code>{workspace.git?.branch ?? 'for this worktree'}</code> is deleted only if fully merged.
        </p>
      )}
    </ConfirmDialog>
  )
}
