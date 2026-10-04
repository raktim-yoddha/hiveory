import { useState } from 'react'
import type { WorkspaceView } from '@shared/domain'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { api, HiveoryError } from '../../lib/api'
import { useNavigation } from '../../stores/navigation'
import { reportError, useNotices } from '../../stores/notices'

interface DeleteWorkspaceDialogProps {
  workspace: WorkspaceView
  onClose: () => void
}

/**
 * Deletes an isolated Workspace. Uncommitted changes require a second,
 * explicit confirmation; unmerged branches are always kept.
 */
export function DeleteWorkspaceDialog({ workspace, onClose }: DeleteWorkspaceDialogProps) {
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const view = useNavigation((s) => s.view)
  const openProject = useNavigation((s) => s.openProject)

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api('workspaces.delete', { workspaceId: workspace.id, force })
      if (view.type === 'workspace' && view.workspaceId === workspace.id) openProject(workspace.projectId, 'workspaces')
      if (result.keptBranch) {
        useNotices.getState().push({
          level: 'info',
          message: `Branch ${result.keptBranch} was kept because it has commits that are not merged.`
        })
      }
      onClose()
    } catch (error) {
      if (error instanceof HiveoryError && error.error.code === 'WORKTREE_DIRTY') setForce(true)
      else reportError(error, 'Delete workspace')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open
      danger
      busy={busy}
      title={force ? 'Discard uncommitted changes?' : `Delete ${workspace.name}?`}
      confirmLabel={force ? 'Delete anyway' : 'Delete workspace'}
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
          <code>{workspace.git?.branch ?? 'for this workspace'}</code> is deleted only if fully merged.
        </p>
      )}
    </ConfirmDialog>
  )
}
