import { useEffect, useState } from 'react'
import { ExternalLink, GitPullRequest, GitPullRequestDraft, RefreshCw } from 'lucide-react'
import { CODE_HOST_INFO } from '@shared/domain/integrations'
import type { WorkspaceView } from '@shared/domain'
import { Button, IconButton } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useWorkspaces } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { DeleteWorkspaceDialog } from '../workspace/DeleteWorkspaceDialog'
import { reviewWords, useCodeReview } from './useCodeReview'
import { WorkspaceCard } from './WorkspaceCard'
import styles from './ProjectScreen.module.css'
import list from './PullRequests.module.css'

const EMPTY: WorkspaceView[] = []

/**
 * Worktrees and their reviews (ADR 0040): each worktree's changes and its pull or merge request (or
 * Create PR/MR), then every open one on the code host. The code host comes from the Workspace's
 * settings or its origin address.
 */
export function WorkspacesTab({ projectId }: { projectId: string }) {
  const workspaces = useWorkspaces((s) => s.byProject[projectId] ?? EMPTY)
  const load = useWorkspaces((s) => s.load)
  const openProject = useNavigation((s) => s.openProject)
  const [deleting, setDeleting] = useState<WorkspaceView | null>(null)
  const [creating, setCreating] = useState<WorkspaceView | null>(null)
  const [busy, setBusy] = useState(false)
  const code = useCodeReview(projectId)
  const words = reviewWords(code.status)
  const hostName = code.status?.host ? CODE_HOST_INFO[code.status.host].name : 'the code host'

  useEffect(() => {
    void load(projectId)
  }, [projectId, load])

  const create = async (draft: boolean): Promise<void> => {
    if (!creating) return
    setBusy(true)
    await code.create(creating, draft)
    setBusy(false)
    setCreating(null)
  }

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
          <WorkspaceCard
            key={ws.id}
            workspace={ws}
            onDelete={() => setDeleting(ws)}
            review={
              code.status?.available
                ? { short: words.short, defaultBranch: code.status.defaultBranch, reviews: code.reviews ?? [], onCreate: () => setCreating(ws) }
                : undefined
            }
          />
        ))}
      </div>

      <section className={list.group} aria-label={words.plural}>
        <div className={list.groupHead}>
          <h3 className={list.groupTitle}>
            {words.plural}
            {code.status?.available ? ` · ${code.reviews?.length ?? 0}` : ''}
          </h3>
          <IconButton label={`Refresh ${words.plural.toLowerCase()}`} icon={<RefreshCw />} onClick={() => void code.load()} />
        </div>
        {!code.status ? (
          <p className={list.empty}>Checking the code host…</p>
        ) : !code.status.available ? (
          <div className={list.empty}>
            <p>{code.status.reason ?? 'No code host for this workspace.'}</p>
            <Button size="sm" variant="ghost" onClick={() => openProject(projectId, 'settings')}>
              Code host settings
            </Button>
          </div>
        ) : code.reviews?.length === 0 ? (
          <p className={list.empty}>No open {words.plural.toLowerCase()} on {code.status.repository}.</p>
        ) : (
          <ul className={list.list}>
            {code.reviews?.map((pr) => (
              <li key={pr.number} className={list.row}>
                {pr.draft ? <GitPullRequestDraft className={list.icon} aria-label="Draft" /> : <GitPullRequest className={list.icon} aria-hidden />}
                <span className={list.rowMain}>
                  <span className={list.rowTitle}>{pr.title}</span>
                  <span className={list.muted}>
                    #{pr.number} · {pr.branch}
                    {pr.author ? ` · ${pr.author}` : ''}
                    {pr.reviewDecision ? ` · ${pr.reviewDecision.toLowerCase().replace('_', ' ')}` : ''}
                  </span>
                </span>
                <a className={list.link} href={pr.url} target="_blank" rel="noreferrer" aria-label={`Open ${words.short} ${pr.number} on ${hostName}`}>
                  <ExternalLink aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {deleting && <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} />}
      <ConfirmDialog
        open={Boolean(creating)}
        busy={busy}
        title={`Open a ${words.long} for ${creating?.name ?? ''}?`}
        confirmLabel={`Push & create ${words.short}`}
        onConfirm={() => void create(false)}
        onClose={() => setCreating(null)}
      >
        <p>
          This pushes its branch to <b>origin</b> and opens a {words.long} on {hostName}, titled from its commits.
        </p>
      </ConfirmDialog>
    </div>
  )
}
