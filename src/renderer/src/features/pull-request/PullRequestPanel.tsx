import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, CircleMinus, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Loader2, RefreshCw, XCircle } from 'lucide-react'
import type { CheckState, MergeMethod, PullRequestCheck, PullRequestDetail } from '@shared/domain/github'
import { Button, IconButton } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Menu } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useNavigation } from '../../stores/navigation'
import { runAction, useNotices } from '../../stores/notices'
import { usePullRequest } from './usePullRequest'
import styles from './PullRequestPanel.module.css'

const openUrl = (url: string): void => void api('system.openUrl', { url }).catch(() => undefined)

const CHECK_ICON: Record<CheckState, typeof CheckCircle2> = {
  success: CheckCircle2,
  failure: XCircle,
  pending: Loader2,
  skipped: CircleMinus,
  neutral: CircleDashed
}

const METHODS: Array<{ id: MergeMethod; label: string; hint: string }> = [
  { id: 'squash', label: 'Squash and merge', hint: 'One commit on the base branch' },
  { id: 'merge', label: 'Create a merge commit', hint: 'Keeps every commit' },
  { id: 'rebase', label: 'Rebase and merge', hint: 'Replays the commits' }
]

/** "1m 23s", "16m 18s", "11s". */
const duration = (seconds: number): string => (seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`)

/** What the checks add up to, as a headline and a count line. */
export function checksSummary(checks: PullRequestCheck[]): { state: CheckState; title: string; counts: string } {
  const n = (s: CheckState): number => checks.filter((c) => c.state === s).length
  const failing = n('failure')
  const running = n('pending')
  const passed = n('success')
  const skipped = n('skipped') + n('neutral')
  const counts = [failing && `${failing} failing`, running && `${running} running`, passed && `${passed} successful`, skipped && `${skipped} skipped`].filter(Boolean).join(', ')
  if (!checks.length) return { state: 'neutral', title: 'No checks', counts: 'The host reports no checks for this branch.' }
  if (failing) return { state: 'failure', title: failing === 1 ? 'A check failed' : `${failing} checks failed`, counts }
  if (running) return { state: 'pending', title: 'Checks are running', counts }
  return { state: 'success', title: 'All checks have passed', counts }
}

/**
 * The side panel's Pull request tab (ADR 0064): the worktree's review on GitHub or GitLab — title,
 * state, its checks with their times, and Merge. Without one it offers Create PR.
 */
export function PullRequestPanel({ workspaceId, projectId }: { workspaceId: string; projectId?: string }) {
  const { detail, error, loading, refresh } = usePullRequest(workspaceId)
  const [creating, setCreating] = useState<'ready' | 'draft' | null>(null)

  const create = async (draft: boolean): Promise<void> => {
    setCreating(draft ? 'draft' : 'ready')
    const made = await runAction('Create pull request', () => api('github.createPullRequest', { workspaceId, draft }))
    setCreating(null)
    if (made) useNotices.getState().push({ level: 'info', message: `Opened ${made.url}` })
    await refresh()
  }

  return (
    <div className={styles.panel}>
      <div className={styles.bar}>
        {detail && (
          <button type="button" className={styles.view} onClick={() => openUrl(detail.url)} title={detail.url}>
            <ExternalLink aria-hidden /> View on {detail.url.includes('gitlab') ? 'GitLab' : 'GitHub'}
          </button>
        )}
        <span className={styles.flex} />
        <IconButton label="Refresh pull request" icon={<RefreshCw className={loading ? 'spin' : undefined} />} onClick={() => void refresh()} />
      </div>
      <div className={styles.body}>
        {error ? (
          <EmptyState
            compact
            icon={<GitPullRequest />}
            title="Pull requests are unavailable"
            description={error}
            actions={
              // A branch reason is fixed by a worktree, not by settings.
              projectId && !/default branch|not on a branch/i.test(error) ? (
                <Button size="sm" onClick={() => useNavigation.getState().openSettings('workspace', projectId)}>
                  Code host settings
                </Button>
              ) : undefined
            }
          />
        ) : detail === undefined ? (
          <div className={styles.loading}>
            <Loader2 className="spin" aria-hidden /> Looking for this branch's pull request…
          </div>
        ) : detail === null ? (
          <EmptyState
            compact
            icon={<GitPullRequest />}
            title="No pull request yet"
            description="Push this worktree's branch and open one, filled from its commits."
            actions={
              <div className={styles.actions}>
                <Button size="sm" variant="primary" icon={<GitPullRequest />} loading={creating === 'ready'} disabled={Boolean(creating)} onClick={() => void create(false)}>
                  Create PR
                </Button>
                <Button size="sm" icon={<GitPullRequestDraft />} loading={creating === 'draft'} disabled={Boolean(creating)} onClick={() => void create(true)}>
                  Draft
                </Button>
              </div>
            }
          />
        ) : (
          <PullRequestView detail={detail} workspaceId={workspaceId} onChanged={() => void refresh()} />
        )}
      </div>
    </div>
  )
}

function StateChip({ detail }: { detail: PullRequestDetail }) {
  const [label, Icon, tone] =
    detail.state === 'merged'
      ? (['Merged', GitMerge, styles.merged] as const)
      : detail.state === 'closed'
        ? (['Closed', GitPullRequestClosed, styles.closed] as const)
        : detail.draft
          ? (['Draft', GitPullRequestDraft, styles.draft] as const)
          : (['Open', GitPullRequest, styles.open] as const)
  return (
    <span className={cx(styles.chip, tone)}>
      <Icon aria-hidden /> {label}
    </span>
  )
}

function PullRequestView({ detail, workspaceId, onChanged }: { detail: PullRequestDetail; workspaceId: string; onChanged: () => void }) {
  const [showChecks, setShowChecks] = useState(true)
  const [method, setMethod] = useState<MergeMethod | null>(null)
  const [merging, setMerging] = useState(false)
  const summary = checksSummary(detail.checks)
  const SummaryIcon = CHECK_ICON[summary.state]
  const canMerge = detail.state === 'open' && !detail.draft && detail.mergeable !== false

  const merge = async (how: MergeMethod): Promise<void> => {
    setMerging(true)
    const done = await runAction('Merge', () => api('github.merge', { workspaceId, number: detail.number, method: how }))
    setMerging(false)
    setMethod(null)
    if (done !== undefined) useNotices.getState().push({ level: 'info', message: `Merged #${detail.number}.` })
    onChanged()
  }

  return (
    <>
      <section className={styles.head}>
        <h2 className={styles.title}>
          {detail.title} <span className={styles.number}>#{detail.number}</span>
        </h2>
        <div className={styles.meta}>
          <StateChip detail={detail} />
          <span className={styles.branches}>
            {detail.branch}
            {detail.baseBranch && <> → {detail.baseBranch}</>}
          </span>
          {detail.author && <span className={styles.muted}>by {detail.author}</span>}
        </div>
        {detail.reviewDecision && <p className={styles.review}>{detail.reviewDecision === 'APPROVED' ? 'Approved' : detail.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes requested' : 'Review required'}</p>}
      </section>

      <section className={cx(styles.summary, styles[summary.state])}>
        <button type="button" className={styles.summaryButton} aria-expanded={showChecks} onClick={() => setShowChecks(!showChecks)} disabled={!detail.checks.length}>
          <SummaryIcon aria-hidden className={cx(styles.summaryIcon, summary.state === 'pending' && 'spin')} />
          <span className={styles.summaryText}>
            <span className={styles.summaryTitle}>{summary.title}</span>
            <span className={styles.muted}>{summary.counts}</span>
          </span>
          {detail.checks.length > 0 && (showChecks ? <ChevronDown aria-hidden className={styles.chevron} /> : <ChevronRight aria-hidden className={styles.chevron} />)}
        </button>
        {showChecks && detail.checks.length > 0 && (
          <ul className={styles.checks} aria-label="Checks">
            {detail.checks.map((check, i) => {
              const Icon = CHECK_ICON[check.state]
              return (
                <li key={`${check.group ?? ''}/${check.name}/${i}`}>
                  <button type="button" className={styles.check} disabled={!check.url} onClick={() => check.url && openUrl(check.url)} title={check.url ? 'Open its log' : undefined}>
                    <Icon aria-label={check.state} className={cx(styles.checkIcon, styles[check.state], check.state === 'pending' && 'spin')} />
                    <span className={styles.checkName}>{check.name}</span>
                    {check.group && <span className={styles.group}>{check.group}</span>}
                    <span className={styles.flex} />
                    {check.seconds !== undefined && <span className={styles.muted}>{duration(check.seconds)}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {detail.state === 'open' && (
        <section className={styles.mergeBox}>
          <Menu
            label="Merge"
            align="start"
            items={METHODS.map((m) => ({ type: 'item' as const, id: m.id, label: m.label, hint: m.hint, onSelect: () => setMethod(m.id) }))}
            trigger={(props) => (
              <Button {...props} variant="primary" icon={<GitMerge />} disabled={!canMerge} loading={merging}>
                Merge pull request
              </Button>
            )}
          />
          <span className={styles.muted}>{detail.draft ? 'A draft cannot be merged yet.' : detail.mergeable === false ? 'It has conflicts with the base branch.' : summary.state === 'failure' ? 'Some checks failed.' : ''}</span>
        </section>
      )}

      <ConfirmDialog
        open={method !== null}
        title={`${METHODS.find((m) => m.id === method)?.label ?? 'Merge'} #${detail.number}?`}
        confirmLabel="Merge"
        busy={merging}
        onClose={() => setMethod(null)}
        onConfirm={() => method && void merge(method)}
      >
        {detail.branch} is merged into {detail.baseBranch ?? 'the base branch'} on the code host. It cannot be undone from here.
      </ConfirmDialog>
    </>
  )
}
