import { useEffect, useState } from 'react'
import type { WorkspaceView } from '@shared/domain'
import { useWorkspaces } from '../../stores/data'
import { DeleteWorkspaceDialog } from '../workspace/DeleteWorkspaceDialog'
import { WorkspaceCard } from './WorkspaceCard'
import styles from './ProjectScreen.module.css'

const EMPTY: WorkspaceView[] = []

export function WorkspacesTab({ projectId }: { projectId: string }) {
  const workspaces = useWorkspaces((s) => s.byProject[projectId] ?? EMPTY)
  const load = useWorkspaces((s) => s.load)
  const [deleting, setDeleting] = useState<WorkspaceView | null>(null)

  useEffect(() => {
    void load(projectId)
  }, [projectId, load])

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Worktrees</h2>
          <p className={styles.muted}>Each worktree gets its own folder and branch, so agents never collide.</p>
        </div>
      </div>
      <div className={styles.grid}>
        {workspaces.map((ws) => (
          <WorkspaceCard key={ws.id} workspace={ws} onDelete={() => setDeleting(ws)} />
        ))}
      </div>
      {deleting && <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}
