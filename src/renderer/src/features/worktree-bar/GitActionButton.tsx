import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowUp, ExternalLink, GitCommitHorizontal, GitCompareArrows, GitMerge, GitPullRequest, GitPullRequestDraft } from 'lucide-react'
import type { WorkspaceView } from '@shared/domain'
import type { GitStatusView } from '@shared/ipc/contract'
import { SplitButton } from '../../components/ui/SplitButton'
import type { MenuEntry } from '../../components/ui/Menu'
import { api, subscribe } from '../../lib/api'
import { useNavigation } from '../../stores/navigation'
import { runAction, useNotices } from '../../stores/notices'
import { openReview, showChanges } from '../changes/changes-store'
import { UNCOMMITTED } from '../changes/useChangeSource'
import { usePullRequest } from '../pull-request/usePullRequest'
import { nextGitStep, type GitStep } from './git-step'

/** Opens the Changes tab and puts the cursor in its commit message. */
const startCommit = (workspaceId: string): void => {
  showChanges(workspaceId, UNCOMMITTED)
  setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Commit message"]')?.focus(), 150)
}

/**
 * The worktree's git button (ADR 0064): its next step first — Commit, Publish branch, Push, Create
 * PR or Merge PR — and every step in the menu, with Review changes and the pull request.
 */
export function GitActionButton({ workspace }: { workspace: WorkspaceView }) {
  const workspaceId = workspace.id
  const [status, setStatus] = useState<GitStatusView | null>(null)
  const [busy, setBusy] = useState(false)
  const { detail: pr, refresh: refreshPr } = usePullRequest(workspaceId)

  const readStatus = useCallback(() => {
    void api('workspaces.gitStatus', { workspaceId })
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [workspaceId])

  useEffect(() => {
    readStatus()
    // Agents report often: one read once things settle.
    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = (): void => {
      clearTimeout(timer)
      timer = setTimeout(readStatus, 800)
    }
    const offs = [subscribe('runtime.changed', (e) => e.workspaceId === workspaceId && soon()), subscribe('files.changed', (e) => e.scope === workspaceId && soon())]
    window.addEventListener('focus', soon)
    return () => {
      clearTimeout(timer)
      for (const off of offs) off()
      window.removeEventListener('focus', soon)
    }
  }, [workspaceId, readStatus])

  const showPr = (): void => useNavigation.getState().showPanelTab(workspaceId, 'pull')
  const push = async (): Promise<void> => {
    setBusy(true)
    const pushed = await runAction('Push', () => api('changes.push', { workspaceId }))
    setBusy(false)
    if (pushed) useNotices.getState().push({ level: 'info', message: `Pushed ${pushed.branch} to ${pushed.upstream}.` })
    readStatus()
  }
  const createPr = async (draft: boolean): Promise<void> => {
    setBusy(true)
    const made = await runAction('Create pull request', () => api('github.createPullRequest', { workspaceId, draft }))
    setBusy(false)
    if (made) useNotices.getState().push({ level: 'info', message: `Opened ${made.url}` })
    readStatus()
    await refreshPr()
    showPr()
  }

  const step = nextGitStep(status, pr, workspace.kind === 'main')
  const uncommitted = status ? status.changed + status.untracked : 0
  const MAIN: Record<GitStep, { label: string; icon: ReactNode; run: () => void }> = {
    commit: { label: 'Commit', icon: <GitCommitHorizontal />, run: () => startCommit(workspaceId) },
    publish: { label: 'Publish branch', icon: <ArrowUp />, run: () => void push() },
    push: { label: `Push${status?.ahead ? ` ${status.ahead}` : ''}`, icon: <ArrowUp />, run: () => void push() },
    'create-pr': { label: 'Create PR', icon: <GitPullRequest />, run: () => void createPr(false) },
    merge: { label: 'Merge PR', icon: <GitMerge />, run: showPr },
    none: { label: 'Commit', icon: <GitCommitHorizontal />, run: () => startCommit(workspaceId) }
  }
  const main = MAIN[step]
  const items: MenuEntry[] = [
    { type: 'item', id: 'commit', label: 'Commit…', hint: uncommitted ? `${uncommitted} changed` : 'Nothing to commit', icon: <GitCommitHorizontal />, disabled: !uncommitted, onSelect: () => startCommit(workspaceId) },
    {
      type: 'item',
      id: 'push',
      label: status?.upstream ? 'Push' : 'Publish branch',
      hint: status?.upstream ? (status.ahead ? `${status.ahead} to push` : 'Up to date') : undefined,
      icon: <ArrowUp />,
      disabled: !status?.branch || (Boolean(status.upstream) && !status.ahead),
      onSelect: () => void push()
    },
    { type: 'separator' },
    { type: 'item', id: 'create-pr', label: 'Create pull request', icon: <GitPullRequest />, disabled: Boolean(pr) || !status?.branch, onSelect: () => void createPr(false) },
    { type: 'item', id: 'create-draft', label: 'Create draft pull request', icon: <GitPullRequestDraft />, disabled: Boolean(pr) || !status?.branch, onSelect: () => void createPr(true) },
    { type: 'item', id: 'view-pr', label: pr ? `Pull request #${pr.number}` : 'Pull request', icon: <GitMerge />, onSelect: showPr },
    ...(pr ? [{ type: 'item' as const, id: 'open-pr', label: 'Open on the code host', icon: <ExternalLink />, onSelect: () => void api('system.openUrl', { url: pr.url }).catch(() => undefined) }] : []),
    { type: 'separator' },
    { type: 'item', id: 'review', label: 'Review changes', icon: <GitCompareArrows />, onSelect: () => void openReview(workspaceId) }
  ]

  if (status === null) return null
  return (
    <SplitButton
      primary={step !== 'none'}
      icon={main.icon}
      label={main.label}
      title={step === 'none' ? 'Nothing to commit' : main.label}
      onClick={main.run}
      disabled={step === 'none'}
      loading={busy}
      menuLabel="Git"
      items={items}
    />
  )
}
