import { AlertTriangle, ArrowDown, ArrowUp, FileDiff, GitBranch, House, MoreHorizontal, Wrench } from 'lucide-react'
import { AgentIcon } from '../../components/brand/AgentIcon'
import type { WorkspaceView } from '@shared/domain'
import { Button, IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { workspaceMenuEntries } from '../workspace/workspace-menu'
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

  const repair = (): void => void runAction('Repair worktree', () => api('workspaces.repair', { workspaceId: workspace.id }))

  const actions = workspaceMenuEntries(workspace, onDelete)

  return (
    <article className={styles.card}>
      <Menu
        context
        label={`${workspace.name} actions`}
        items={actions}
        trigger={(props) => (
          <button {...props} type="button" className={styles.open} onClick={() => openWorkspace(workspace.projectId, workspace.id)}>
            <span className={styles.top}>
              {isMain ? <House className={styles.kindIcon} aria-hidden /> : <GitBranch className={styles.kindIcon} aria-hidden />}
              <span className={styles.name}>{workspace.name}</span>
              {isMain && <span className={styles.badge}>Primary</span>}
            </span>
            {branch && <span className={styles.branch}>{branch}</span>}
            <span className={styles.stats}>
              <span className={styles.meta}>
                <AgentIcon aria-hidden />
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
        )}
      />
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
      <div className={styles.actions}>
        <Menu
          label={`${workspace.name} actions`}
          align="end"
          items={actions}
          trigger={(props) => <IconButton {...props} label={`${workspace.name} actions`} icon={<MoreHorizontal />} />}
        />
      </div>
    </article>
  )
}
