import { AlertTriangle, ArrowDown, ArrowUp, ExternalLink, FileDiff, GitBranch, GitPullRequest, House, MoreHorizontal, Wrench } from 'lucide-react'
import type { PullRequest } from '@shared/domain/github'
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

/** The worktree's pull (or merge) request, or the way to open one (ADR 0040); absent without a code host. */
export interface CardReview {
  /** "PR" or "MR". */
  short: string
  defaultBranch?: string
  /** The open ones; the card finds its own by its live branch. */
  reviews: PullRequest[]
  onCreate: () => void
}

interface WorkspaceCardProps {
  workspace: WorkspaceView
  onDelete: () => void
  review?: CardReview
}

export function WorkspaceCard({ workspace, onDelete, review }: WorkspaceCardProps) {
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const isMain = workspace.kind === 'main'
  const status = useGitStatus(workspace.id, workspace.healthy)
  const branch = status?.branch ?? workspace.git?.branch

  const repair = (): void => void runAction('Repair worktree', () => api('workspaces.repair', { workspaceId: workspace.id }))

  const actions = workspaceMenuEntries(workspace, onDelete)
  // Any branch but the default one can be reviewed: a linked worktree's, or the Primary's while it is elsewhere.
  const pr = branch ? review?.reviews.find((r) => r.branch === branch) : undefined
  const canReview = Boolean(review && !pr && branch && branch !== review.defaultBranch && workspace.healthy)

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
      {review && pr ? (
        <a className={styles.review} href={pr.url} target="_blank" rel="noreferrer" title={pr.title}>
          <GitPullRequest aria-hidden />
          {review.short} #{pr.number}
          {pr.draft ? ' · draft' : ''}
          <ExternalLink aria-hidden />
        </a>
      ) : (
        canReview && (
          <div className={styles.reviewRow}>
            <Button size="sm" variant="ghost" icon={<GitPullRequest />} onClick={review!.onCreate}>
              Create {review!.short}
            </Button>
          </div>
        )
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
