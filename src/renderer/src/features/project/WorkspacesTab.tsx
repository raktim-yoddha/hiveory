import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { WorkspaceView } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { useWorkspaces } from '../../stores/data'
import { CreateWorkspaceDialog } from '../workspace-create/CreateWorkspaceDialog'
import { DeleteWorkspaceDialog } from '../workspace/DeleteWorkspaceDialog'
import { WorkspaceCard } from './WorkspaceCard'
import styles from './ProjectScreen.module.css'

const EMPTY: WorkspaceView[] = []

export function WorkspacesTab({ projectId }: { projectId: string }) {
  const workspaces = useWorkspaces((s) => s.byProject[projectId] ?? EMPTY)
  const load = useWorkspaces((s) => s.load)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<WorkspaceView | null>(null)

  useEffect(() => {
    void load(projectId)
  }, [projectId, load])

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Workspaces</h2>
          <p className={styles.muted}>Each workspace gets its own folder and branch, so agents never collide.</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
          Create workspace
        </Button>
      </div>
      <div className={styles.grid}>
        {workspaces.map((ws) => (
          <WorkspaceCard key={ws.id} workspace={ws} onDelete={() => setDeleting(ws)} />
        ))}
      </div>
      {creating && <CreateWorkspaceDialog projectId={projectId} onClose={() => setCreating(false)} />}
      {deleting && <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}
