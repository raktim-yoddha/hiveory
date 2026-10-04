import { AlertTriangle, Bot, GitBranch, House, MoreHorizontal, Trash2 } from 'lucide-react'
import type { WorkspaceView } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { useNavigation } from '../../stores/navigation'
import styles from './WorkspaceCard.module.css'

interface WorkspaceCardProps {
  workspace: WorkspaceView
  onDelete: () => void
}

export function WorkspaceCard({ workspace, onDelete }: WorkspaceCardProps) {
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const isMain = workspace.kind === 'main'
  const branch = workspace.git?.branch

  return (
    <article className={styles.card}>
      <button type="button" className={styles.open} onClick={() => openWorkspace(workspace.projectId, workspace.id)}>
        <span className={styles.top}>
          {isMain ? <House className={styles.kindIcon} aria-hidden /> : <GitBranch className={styles.kindIcon} aria-hidden />}
          <span className={styles.name}>{workspace.name}</span>
          {isMain && <span className={styles.badge}>Main</span>}
        </span>
        {branch && <span className={styles.branch}>{branch}</span>}
        <span className={styles.meta}>
          <Bot aria-hidden />
          {workspace.agentCount === 0 ? 'No agents' : `${workspace.agentCount} ${workspace.agentCount === 1 ? 'agent' : 'agents'}`}
        </span>
        {!workspace.healthy && (
          <span className={styles.warning}>
            <AlertTriangle aria-hidden />
            Folder missing on disk
          </span>
        )}
      </button>
      {!isMain && (
        <div className={styles.actions}>
          <Menu
            label={`${workspace.name} actions`}
            align="end"
            items={[{ type: 'item', id: 'delete', label: 'Delete workspace', icon: <Trash2 />, danger: true, onSelect: onDelete }]}
            trigger={(props) => <IconButton {...props} label={`${workspace.name} actions`} icon={<MoreHorizontal />} />}
          />
        </div>
      )}
    </article>
  )
}
