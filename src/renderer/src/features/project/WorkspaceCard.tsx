import { AlertTriangle, ArrowDown, ArrowUp, Bot, FileDiff, GitBranch, House, MoreHorizontal, Trash2, Wrench } from 'lucide-react'
import type { WorkspaceView } from '@shared/domain'
import { Button, IconButton } from '../../components/ui/Button'
import { Menu, type MenuEntry } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { useGitStatus } from './useGitStatus'
import styles from './WorkspaceCard.module.css'

interface WorkspaceCardProps {
  workspace: WorkspaceView
  onDelete: () => void
}

export function WorkspaceCard({ workspace, onDelete }: WorkspaceCardProps) {
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const isMain = workspace.kind === 'main'
  const status = useGitStatus(workspace.id, workspace.healthy)
  const branch = status?.branch ?? workspace.git?.branch

  const repair = (): void => void runAction('Repair workspace', () => api('workspaces.repair', { workspaceId: workspace.id }))

  const actions: MenuEntry[] = isMain
    ? []
    : [
        { type: 'item', id: 'repair', label: 'Repair folder', icon: <Wrench />, onSelect: repair },
        { type: 'separator' },
        { type: 'item', id: 'delete', label: 'Delete workspace', icon: <Trash2 />, danger: true, onSelect: onDelete }
      ]

  return (
    <article className={styles.card}>
      <button type="button" className={styles.open} onClick={() => openWorkspace(workspace.projectId, workspace.id)}>
        <span className={styles.top}>
          {isMain ? <House className={styles.kindIcon} aria-hidden /> : <GitBranch className={styles.kindIcon} aria-hidden />}
          <span className={styles.name}>{workspace.name}</span>
          {isMain && <span className={styles.badge}>Main</span>}
        </span>
        {branch && <span className={styles.branch}>{branch}</span>}
        <span className={styles.stats}>
          <span className={styles.meta}>
            <Bot aria-hidden />
            {workspace.agentCount === 0 ? 'No agents' : `${workspace.agentCount} ${workspace.agentCount === 1 ? 'agent' : 'agents'}`}
          </span>
          {status && (
            <>
              <span className={styles.meta} title="Changed files (including untracked)">
                <FileDiff aria-hidden />
                {status.changed + status.untracked === 0 ? 'Clean' : `${status.changed + status.untracked} changed`}
              </span>
              {(status.ahead > 0 || status.behind > 0) && (
                <span className={styles.meta} title={`Compared with ${status.upstream ?? 'upstream'}`}>
                  <ArrowUp aria-hidden />
                  {status.ahead}
                  <ArrowDown aria-hidden />
                  {status.behind}
                </span>
              )}
            </>
          )}
        </span>
      </button>
      {!workspace.healthy && (
        <div className={styles.warning}>
          <AlertTriangle aria-hidden />
          <span>Folder missing on disk</span>
          {!isMain && (
            <Button size="sm" icon={<Wrench />} onClick={repair}>
              Repair
            </Button>
          )}
        </div>
      )}
      {!isMain && (
        <div className={styles.actions}>
          <Menu
            label={`${workspace.name} actions`}
            align="end"
            items={actions}
            trigger={(props) => <IconButton {...props} label={`${workspace.name} actions`} icon={<MoreHorizontal />} />}
          />
        </div>
      )}
    </article>
  )
}
