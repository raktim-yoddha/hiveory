import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, GitPullRequest, GitPullRequestDraft, RefreshCw } from 'lucide-react'
import type { GithubStatus, PullRequest } from '@shared/domain/github'
import type { WorkspaceView } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { api } from '../../lib/api'
import { useWorkspaces } from '../../stores/data'
import { runAction, useNotices } from '../../stores/notices'
import styles from './PullRequests.module.css'

const NO_WORKSPACES: WorkspaceView[] = []

/**
 * Pull requests through the GitHub CLI (`gh`) the user already signed in to.
 * Lists open PRs and opens one from any isolated workspace branch.
 */
export function PullRequestsTab({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<GithubStatus | null>(null)
  const [prs, setPrs] = useState<PullRequest[] | null>(null)
  const [creating, setCreating] = useState<WorkspaceView | null>(null)
  const [busy, setBusy] = useState(false)
  const workspaces = useWorkspaces((s) => s.byProject[projectId] ?? NO_WORKSPACES)
  const branches = workspaces.filter((w) => w.kind === 'isolated' && w.git?.branch)

  const load = useCallback(async () => {
    const next = await runAction('Check GitHub', () => api('github.status', { projectId }))
    setStatus(next ?? { available: false, reason: 'Could not reach the GitHub CLI.' })
    if (next?.available) {
      const list = await runAction('Load pull requests', () => api('github.pullRequests', { projectId }))
      setPrs(list ?? [])
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    void api('github.status', { projectId })
      .then(async (next) => {
        if (cancelled) return
        setStatus(next)
        if (next.available) {
          const list = await api('github.pullRequests', { projectId })
          if (!cancelled) setPrs(list)
        }
      })
      .catch(() => !cancelled && setStatus({ available: false, reason: 'Could not reach the GitHub CLI.' }))
    return () => {
      cancelled = true
    }
  }, [projectId])

  const create = async (draft: boolean): Promise<void> => {
    if (!creating) return
    setBusy(true)
    const result = await runAction('Create pull request', () => api('github.createPullRequest', { workspaceId: creating.id, draft }))
    setBusy(false)
    setCreating(null)
    if (result) {
      useNotices.getState().push({ level: 'info', message: `Pull request created: ${result.url}` })
      void load()
    }
  }

  if (!status) return <EmptyState compact icon={<GitPullRequest />} title="Checking GitHub…" />
  if (!status.available) {
    return (
      <EmptyState
        icon={<GitPullRequest />}
        title="Pull requests need the GitHub CLI"
        description={status.reason ?? 'Install gh and run "gh auth login", then refresh.'}
        actions={
          <Button icon={<RefreshCw />} onClick={() => void load()}>
            Check again
          </Button>
        }
      />
    )
  }

  const prFor = (branch?: string) => prs?.find((p) => p.branch === branch)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{status.repository}</h2>
          <p className={styles.muted}>Open pull requests and your workspace branches.</p>
        </div>
        <Button size="sm" icon={<RefreshCw />} onClick={() => void load()}>
          Refresh
        </Button>
      </header>

      <section className={styles.group}>
        <h3 className={styles.groupTitle}>Workspace branches</h3>
        {branches.length === 0 && <p className={styles.empty}>Create a New branch workspace to open pull requests from it.</p>}
        <ul className={styles.list}>
          {branches.map((w) => {
            const pr = prFor(w.git?.branch)
            return (
              <li key={w.id} className={styles.row}>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{w.name}</span>
                  <span className={styles.branch}>{w.git?.branch}</span>
                </span>
                {pr ? (
                  <a className={styles.link} href={pr.url} target="_blank" rel="noreferrer">
                    #{pr.number} <ExternalLink aria-hidden />
                  </a>
                ) : (
                  <Button size="sm" icon={<GitPullRequest />} onClick={() => setCreating(w)}>
                    Create PR
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className={styles.group}>
        <h3 className={styles.groupTitle}>Open pull requests · {prs?.length ?? 0}</h3>
        {prs && prs.length === 0 && <p className={styles.empty}>No open pull requests.</p>}
        <ul className={styles.list}>
          {prs?.map((pr) => (
            <li key={pr.number} className={styles.row}>
              {pr.draft ? <GitPullRequestDraft className={styles.icon} aria-label="Draft" /> : <GitPullRequest className={styles.icon} aria-hidden />}
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{pr.title}</span>
                <span className={styles.muted}>
                  #{pr.number} · {pr.branch} · {pr.author}
                  {pr.reviewDecision ? ` · ${pr.reviewDecision.toLowerCase().replace('_', ' ')}` : ''}
                </span>
              </span>
              <a className={styles.link} href={pr.url} target="_blank" rel="noreferrer" aria-label={`Open pull request ${pr.number} on GitHub`}>
                <ExternalLink aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={Boolean(creating)}
        busy={busy}
        title={`Open a pull request for ${creating?.name ?? ''}?`}
        confirmLabel="Push & create PR"
        onConfirm={() => void create(false)}
        onClose={() => setCreating(null)}
      >
        <p>
          This pushes <code>{creating?.git?.branch}</code> to <b>origin</b> and opens a pull request titled from its commits.
        </p>
      </ConfirmDialog>
    </div>
  )
}
