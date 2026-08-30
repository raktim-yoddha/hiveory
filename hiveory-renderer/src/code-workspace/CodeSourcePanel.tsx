import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react'
import {
  hiveoryClient,
  type CodeGitBranch,
  type CodeGitCommit,
  type CodeGitDiff,
  type CodeGitRepositorySummary,
  type CodeGitStatus,
  type CodeHostedAuthState,
  type CodeHostedIssue,
  type CodeHostedPullRequest,
  type CodeHostedTracking,
  type CodeWorkspaceSummary,
} from '../api/hiveory-client'

type SourceTab = 'changes' | 'branches' | 'commits' | 'issues' | 'pulls' | 'checks'

interface CodeSourcePanelProps {
  workspace: CodeWorkspaceSummary
  onClose: () => void
}

interface SourceSnapshot {
  status: CodeGitStatus | null
  repository: CodeGitRepositorySummary | null
  hosted: CodeHostedTracking | null
}

const TAB_ITEMS: Array<{ id: SourceTab; label: string; icon: React.ReactNode }> = [
  { id: 'changes', label: 'Changes', icon: <FileCode2 size={13} aria-hidden="true" /> },
  { id: 'branches', label: 'Branches', icon: <GitBranch size={13} aria-hidden="true" /> },
  { id: 'commits', label: 'Commits', icon: <History size={13} aria-hidden="true" /> },
  { id: 'issues', label: 'Issues', icon: <CircleDot size={13} aria-hidden="true" /> },
  { id: 'pulls', label: 'Pull requests', icon: <GitPullRequest size={13} aria-hidden="true" /> },
  { id: 'checks', label: 'Checks', icon: <CheckCircle2 size={13} aria-hidden="true" /> },
]

function formatCount(value: number): string {
  return value > 99 ? '99+' : String(value)
}

function normalizeState(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ')
}

function hostedStateMessage(state: CodeHostedAuthState): string {
  switch (state) {
    case 'missing_cli': return 'Install the hosted-source CLI and add it to PATH to load collaboration data.'
    case 'not_authenticated': return 'Sign in with the hosted-source CLI. Credentials stay outside this app.'
    case 'no_repository': return 'No hosted remote could be resolved for this repository.'
    case 'offline': return 'The hosted source is offline. Local Git data is still available.'
    case 'rate_limited': return 'The hosted source rate limit was reached. Refresh later.'
    case 'error': return 'Hosted collaboration data could not be loaded. Refresh to retry.'
    default: return ''
  }
}

function branchLabel(branch: CodeGitBranch): string {
  if (branch.current) return 'current'
  if (branch.upstream) return branch.upstream
  return 'local only'
}

function commitDate(commit: CodeGitCommit): string {
  if (!commit.committed_at_unix_ms) return 'date unavailable'
  return new Date(commit.committed_at_unix_ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function checkTone(state: string): string {
  if (state === 'failed') return 'is-danger'
  if (state === 'pending') return 'is-warning'
  if (state === 'passed') return 'is-success'
  return 'is-muted'
}

export const CodeSourcePanel: React.FC<CodeSourcePanelProps> = ({ workspace, onClose }) => {
  const [tab, setTab] = useState<SourceTab>('changes')
  const [snapshot, setSnapshot] = useState<SourceSnapshot>({ status: null, repository: null, hosted: null })
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedDiff, setSelectedDiff] = useState<CodeGitDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSource = useCallback(async () => {
    if (workspace.trust !== 'trusted') {
      setSnapshot({ status: null, repository: null, hosted: null })
      setSelectedDiff(null)
      setError('Trust this workspace to inspect local source state.')
      return
    }
    setLoading(true)
    setError(null)
    const [statusResult, repositoryResult, hostedResult] = await Promise.allSettled([
      hiveoryClient.codeGitStatus({ workspace_id: workspace.id }),
      hiveoryClient.codeGitRepository({ workspace_id: workspace.id }),
      hiveoryClient.codeHostedTracking({ workspace_id: workspace.id }),
    ])
    const nextStatus = statusResult.status === 'fulfilled' ? statusResult.value : null
    const nextRepository = repositoryResult.status === 'fulfilled' ? repositoryResult.value : null
    const nextHosted = hostedResult.status === 'fulfilled' ? hostedResult.value : null
    setSnapshot({ status: nextStatus, repository: nextRepository, hosted: nextHosted })
    const firstError = [statusResult, repositoryResult, hostedResult].find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (firstError) setError(firstError.reason instanceof Error ? firstError.reason.message : String(firstError.reason))
    setLoading(false)
  }, [workspace.id, workspace.trust])

  useEffect(() => {
    void loadSource()
  }, [loadSource])

  const loadDiff = async (relativePath: string) => {
    setSelectedPath(relativePath)
    setDiffLoading(true)
    try {
      setSelectedDiff(await hiveoryClient.codeGitDiff({ workspace_id: workspace.id, relative_path: relativePath }))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setSelectedDiff(null)
    } finally {
      setDiffLoading(false)
    }
  }

  const hosted = snapshot.hosted
  const status = snapshot.status
  const repository = snapshot.repository
  const issues = hosted?.issues ?? []
  const pullRequests = hosted?.pull_requests ?? []
  const changedFiles = status?.files ?? []
  const activeChecks = pullRequests.filter((pullRequest) => pullRequest.check_state !== 'none')

  return (
    <aside className="code-source-panel" aria-label="Source control">
      <header className="code-source-panel-header">
        <div className="code-source-panel-title">
          <span className="code-source-panel-icon"><GitBranch size={16} aria-hidden="true" /></span>
          <div>
            <strong>Source control</strong>
            <span>{workspace.display_name}</span>
          </div>
        </div>
        <div className="code-source-panel-actions">
          <button type="button" className="code-source-icon-button" onClick={() => void loadSource()} disabled={loading} aria-label="Refresh source control" title="Refresh source control">
            <RefreshCw size={14} className={loading ? 'is-spinning' : ''} aria-hidden="true" />
          </button>
          <button type="button" className="code-source-icon-button" onClick={onClose} aria-label="Close source control" title="Close source control">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="code-source-repository-strip">
        <div>
          <strong>{repository?.repository_name ?? workspace.repository_name ?? 'Repository'}</strong>
          <span>{status?.branch ?? workspace.branch ?? (repository?.detached ? 'detached HEAD' : 'branch unavailable')}</span>
        </div>
        <div className="code-source-repository-stats">
          <span className={changedFiles.length > 0 ? 'is-warning' : 'is-success'}>{changedFiles.length} changes</span>
          <span>{status?.ahead ?? 0} ahead</span>
          <span>{status?.behind ?? 0} behind</span>
        </div>
      </div>

      <div className="code-source-tabs" role="tablist" aria-label="Source control views">
        {TAB_ITEMS.map((item) => {
          const count = item.id === 'changes' ? changedFiles.length : item.id === 'issues' ? issues.length : item.id === 'pulls' ? pullRequests.length : item.id === 'checks' ? activeChecks.length : undefined
          return (
            <button
              type="button"
              role="tab"
              key={item.id}
              aria-selected={tab === item.id}
              className={tab === item.id ? 'is-selected' : ''}
              onClick={() => setTab(item.id)}
            >
              {item.icon}<span>{item.label}</span>{count !== undefined && <small>{formatCount(count)}</small>}
            </button>
          )
        })}
      </div>

      {error && <div className="code-source-alert" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{error}</span></div>}
      {hosted && hosted.auth_state !== 'ready' && (
        <div className="code-source-hosted-state" role="status">
          <ShieldAlert size={14} aria-hidden="true" />
          <span>{hosted.message ?? hostedStateMessage(hosted.auth_state)}</span>
        </div>
      )}

      <div className="code-source-panel-body">
        {loading && <div className="code-source-loading" role="status"><RefreshCw size={16} className="is-spinning" aria-hidden="true" />Refreshing source state…</div>}
        {!loading && tab === 'changes' && <ChangesView files={changedFiles} selectedPath={selectedPath} selectedDiff={selectedDiff} diffLoading={diffLoading} onSelect={loadDiff} />}
        {!loading && tab === 'branches' && <BranchesView repository={repository} />}
        {!loading && tab === 'commits' && <CommitsView commits={repository?.commits ?? []} />}
        {!loading && tab === 'issues' && <IssuesView issues={issues} />}
        {!loading && tab === 'pulls' && <PullRequestsView pullRequests={pullRequests} />}
        {!loading && tab === 'checks' && <ChecksView pullRequests={activeChecks} />}
      </div>
    </aside>
  )
}

function EmptyView({ title, detail }: { title: string; detail: string }) {
  return <div className="code-source-empty"><CircleDot size={20} aria-hidden="true" /><strong>{title}</strong><span>{detail}</span></div>
}

function ChangesView({ files, selectedPath, selectedDiff, diffLoading, onSelect }: { files: CodeGitStatus['files']; selectedPath: string | null; selectedDiff: CodeGitDiff | null; diffLoading: boolean; onSelect: (path: string) => void }) {
  if (files.length === 0) return <EmptyView title="Working tree clean" detail="No staged, unstaged, untracked, or conflicted files were found." />
  return <div className="code-source-changes-view">
    <div className="code-source-file-list" role="list" aria-label="Changed files">
      {files.map((file) => <button type="button" role="listitem" key={`${file.relative_path}-${file.status}`} className={`code-source-file-row ${selectedPath === file.relative_path ? 'is-selected' : ''}`} onClick={() => onSelect(file.relative_path)}><span className={`code-source-file-status ${file.conflict ? 'is-conflict' : file.staged ? 'is-staged' : ''}`}>{file.conflict ? '!' : file.staged ? 'S' : 'M'}</span><span>{file.relative_path}</span><small>{normalizeState(file.status)}</small></button>)}
    </div>
    <div className="code-source-diff-view" aria-live="polite">
      {!selectedPath && <EmptyView title="Select a file" detail="Choose a changed file to inspect its bounded diff." />}
      {selectedPath && diffLoading && <div className="code-source-loading"><RefreshCw size={15} className="is-spinning" aria-hidden="true" />Loading diff…</div>}
      {selectedPath && !diffLoading && selectedDiff && <><div className="code-source-diff-heading"><FileCode2 size={14} aria-hidden="true" /><strong>{selectedPath}</strong>{selectedDiff.truncated && <small>truncated</small>}</div><pre>{selectedDiff.content || 'No textual diff is available for this file.'}</pre></>}
    </div>
  </div>
}

function BranchesView({ repository }: { repository: CodeGitRepositorySummary | null }) {
  if (!repository) return <EmptyView title="Repository details unavailable" detail="Trust the workspace and refresh to inspect branches and worktrees." />
  return <div className="code-source-list-view">
    <div className="code-source-list-heading"><strong>Branches</strong><span>{repository.branches.length}</span></div>
    {repository.branches.length === 0 ? <EmptyView title="No local branches" detail="The repository may be empty or detached." /> : repository.branches.map((branch) => <div className="code-source-branch-row" key={branch.name}><GitBranch size={14} aria-hidden="true" /><div><strong>{branch.name}</strong><span>{branchLabel(branch)}</span></div><small>{branch.ahead} ↑ · {branch.behind} ↓</small></div>)}
    <div className="code-source-list-heading code-source-subheading"><strong>Worktrees</strong><span>{repository.worktrees.length}</span></div>
    {repository.worktrees.length === 0 ? <p className="code-source-muted">No linked worktrees are registered.</p> : repository.worktrees.map((worktree) => <div className="code-source-worktree-row" key={`${worktree.name}-${worktree.path}`}><span className={`code-source-status-dot ${worktree.dirty_files.length ? 'is-warning' : 'is-success'}`} /><div><strong>{worktree.name}</strong><span>{worktree.branch ?? 'detached'} · {worktree.dirty_files.length} changes</span></div><small>{worktree.locked ? 'locked' : 'available'}</small></div>)}
  </div>
}

function CommitsView({ commits }: { commits: CodeGitCommit[] }) {
  if (commits.length === 0) return <EmptyView title="No commits available" detail="Create the first commit or refresh this workspace." />
  return <div className="code-source-list-view">{commits.map((commit) => <div className="code-source-commit-row" key={commit.oid}><GitCommitHorizontal size={14} aria-hidden="true" /><div><strong>{commit.message || 'No commit message'}</strong><span>{commit.short_oid} · {commit.author ?? 'Unknown author'}</span></div><small>{commitDate(commit)}</small></div>)}</div>
}

function IssuesView({ issues }: { issues: CodeHostedIssue[] }) {
  if (issues.length === 0) return <EmptyView title="No issues to show" detail="Issues will appear after hosted-source authentication and repository resolution." />
  return <div className="code-source-list-view">{issues.map((issue) => <a className="code-source-hosted-row" href={issue.url || undefined} target="_blank" rel="noreferrer" key={issue.number}><span className="code-source-hosted-number">#{issue.number}</span><div><strong>{issue.title}</strong><span>{normalizeState(issue.state)} · {issue.author ?? 'Unknown author'}{issue.labels.length ? ` · ${issue.labels.join(', ')}` : ''}</span></div><ExternalLink size={13} aria-hidden="true" /></a>)}</div>
}

function PullRequestsView({ pullRequests }: { pullRequests: CodeHostedPullRequest[] }) {
  if (pullRequests.length === 0) return <EmptyView title="No pull requests to show" detail="Pull requests will appear after hosted-source authentication and repository resolution." />
  return <div className="code-source-list-view">{pullRequests.map((pullRequest) => <a className="code-source-hosted-row" href={pullRequest.url || undefined} target="_blank" rel="noreferrer" key={pullRequest.number}><GitPullRequest size={14} aria-hidden="true" /><div><strong>#{pullRequest.number} {pullRequest.title}</strong><span>{pullRequest.draft ? 'draft · ' : ''}{normalizeState(pullRequest.state)} · {pullRequest.head_branch} → {pullRequest.base_branch} · {pullRequest.author ?? 'Unknown author'}</span></div><span className={`code-source-check-pill ${checkTone(pullRequest.check_state)}`}>{pullRequest.check_state}</span></a>)}</div>
}

function ChecksView({ pullRequests }: { pullRequests: CodeHostedPullRequest[] }) {
  if (pullRequests.length === 0) return <EmptyView title="No check runs to show" detail="Checks are derived from tracked pull requests and refresh with source data." />
  return <div className="code-source-list-view">{pullRequests.map((pullRequest) => <div className="code-source-check-row" key={pullRequest.number}><span className={`code-source-check-icon ${checkTone(pullRequest.check_state)}`}><CheckCircle2 size={14} aria-hidden="true" /></span><div><strong>#{pullRequest.number} {pullRequest.title}</strong><span>{pullRequest.review_decision ? `Review: ${normalizeState(pullRequest.review_decision)}` : 'Review decision unavailable'}</span></div><span className={`code-source-check-pill ${checkTone(pullRequest.check_state)}`}>{pullRequest.check_state}</span></div>)}</div>
}
