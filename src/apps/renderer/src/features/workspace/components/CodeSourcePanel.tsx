import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  CircleDot,
  CloudDownload,
  CloudUpload,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
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
} from '../../../shared/api/hiveory-client'

type SourceTab = 'changes' | 'branches' | 'commits' | 'issues' | 'pulls' | 'checks'

interface CodeSourcePanelProps {
  workspace: CodeWorkspaceSummary
  onClose: () => void
  onWorkspaceChanged?: () => Promise<unknown>
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

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export const CodeSourcePanel: React.FC<CodeSourcePanelProps> = ({ workspace, onClose, onWorkspaceChanged }) => {
  const [tab, setTab] = useState<SourceTab>('changes')
  const [snapshot, setSnapshot] = useState<SourceSnapshot>({ status: null, repository: null, hosted: null })
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [selectedDiff, setSelectedDiff] = useState<CodeGitDiff | null>(null)
  const [diffStaged, setDiffStaged] = useState(false)
  const [loading, setLoading] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [selectedRemote, setSelectedRemote] = useState<string | null>(null)
  const [branchName, setBranchName] = useState('')
  const [stashMessage, setStashMessage] = useState('')
  const [showIssueForm, setShowIssueForm] = useState(false)
  const [issueTitle, setIssueTitle] = useState('')
  const [issueBody, setIssueBody] = useState('')
  const [issueLabels, setIssueLabels] = useState('')
  const [showPullRequestForm, setShowPullRequestForm] = useState(false)
  const [pullRequestTitle, setPullRequestTitle] = useState('')
  const [pullRequestBody, setPullRequestBody] = useState('')
  const [pullRequestBase, setPullRequestBase] = useState('')
  const [pullRequestDraft, setPullRequestDraft] = useState(false)

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
    if (firstError) setError(errorMessage(firstError.reason))
    setLoading(false)
  }, [workspace.id, workspace.trust])

  useEffect(() => {
    void loadSource()
  }, [loadSource])

  const repositoryRemotes = useMemo(() => snapshot.repository?.remotes ?? [], [snapshot.repository?.remotes])
  useEffect(() => {
    if (selectedRemote && repositoryRemotes.some((remote) => remote.name === selectedRemote)) return
    setSelectedRemote(repositoryRemotes[0]?.name ?? null)
  }, [repositoryRemotes, selectedRemote])

  const loadDiff = async (relativePath: string, staged = diffStaged) => {
    setSelectedPath(relativePath)
    setDiffStaged(staged)
    setDiffLoading(true)
    setError(null)
    try {
      setSelectedDiff(await hiveoryClient.codeGitDiff({ workspace_id: workspace.id, relative_path: relativePath, staged }))
    } catch (reason: unknown) {
      setError(errorMessage(reason))
      setSelectedDiff(null)
    } finally {
      setDiffLoading(false)
    }
  }

  const runAction = useCallback(async (name: string, action: () => Promise<{ message: string }>) => {
    setBusyAction(name)
    setError(null)
    setNotice(null)
    try {
      const result = await action()
      setNotice(result.message)
      setSelectedPaths(new Set())
      await loadSource()
      await onWorkspaceChanged?.()
    } catch (reason: unknown) {
      setError(errorMessage(reason))
    } finally {
      setBusyAction(null)
    }
  }, [loadSource, onWorkspaceChanged])

  const runStage = (relativePaths: string[], stage: boolean, actionName: string) => {
    void runAction(actionName, () => hiveoryClient.stageCodeGit({ workspace_id: workspace.id, relative_paths: relativePaths, stage }))
  }

  const changedFiles = snapshot.status?.files ?? []
  const selectedPathList = useMemo(() => [...selectedPaths], [selectedPaths])
  const hosted = snapshot.hosted
  const repository = snapshot.repository
  const issues = hosted?.issues ?? []
  const pullRequests = hosted?.pull_requests ?? []
  const activeChecks = pullRequests.filter((pullRequest) => pullRequest.check_state !== 'none')
  const hostedReady = hosted?.auth_state === 'ready' && hosted.repository !== null
  const canMutate = workspace.trust === 'trusted' && workspace.is_git_repository

  const createIssue = () => {
    void runAction('issue-create', async () => {
      const result = await hiveoryClient.createCodeHostedIssue({
        workspace_id: workspace.id,
        title: issueTitle,
        body: issueBody,
        labels: issueLabels.split(',').map((label) => label.trim()).filter(Boolean),
      })
      setIssueTitle('')
      setIssueBody('')
      setIssueLabels('')
      setShowIssueForm(false)
      return result
    })
  }

  const createPullRequest = () => {
    void runAction('pull-request-create', async () => {
      const result = await hiveoryClient.createCodeHostedPullRequest({
        workspace_id: workspace.id,
        title: pullRequestTitle,
        body: pullRequestBody,
        base_branch: pullRequestBase.trim() || null,
        draft: pullRequestDraft,
      })
      setPullRequestTitle('')
      setPullRequestBody('')
      setPullRequestBase('')
      setPullRequestDraft(false)
      setShowPullRequestForm(false)
      return result
    })
  }

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
          <button type="button" className="code-source-icon-button" onClick={() => void loadSource()} disabled={loading || busyAction !== null} aria-label="Refresh source control" title="Refresh source control">
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
          <span>{snapshot.status?.branch ?? workspace.branch ?? (repository?.detached ? 'detached HEAD' : 'branch unavailable')}</span>
        </div>
        <div className="code-source-repository-stats">
          <span className={changedFiles.length > 0 ? 'is-warning' : 'is-success'}>{changedFiles.length} changes</span>
          <span>{snapshot.status?.ahead ?? 0} ahead</span>
          <span>{snapshot.status?.behind ?? 0} behind</span>
        </div>
      </div>

      <div className="code-source-tabs" role="tablist" aria-label="Source control views">
        {TAB_ITEMS.map((item) => {
          const count = item.id === 'changes' ? changedFiles.length : item.id === 'issues' ? issues.length : item.id === 'pulls' ? pullRequests.length : item.id === 'checks' ? activeChecks.length : undefined
          return (
            <button type="button" role="tab" key={item.id} aria-selected={tab === item.id} className={tab === item.id ? 'is-selected' : ''} onClick={() => setTab(item.id)}>
              {item.icon}<span>{item.label}</span>{count !== undefined && <small>{formatCount(count)}</small>}
            </button>
          )
        })}
      </div>

      {error && <div className="code-source-alert" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{error}</span></div>}
      {notice && !error && <div className="code-source-notice" role="status"><Check size={14} aria-hidden="true" /><span>{notice}</span></div>}
      {hosted && hosted.auth_state !== 'ready' && (
        <div className="code-source-hosted-state" role="status">
          <ShieldAlert size={14} aria-hidden="true" />
          <span>{hosted.message ?? hostedStateMessage(hosted.auth_state)}</span>
        </div>
      )}

      <div className="code-source-panel-body">
        {loading && <div className="code-source-loading" role="status"><RefreshCw size={16} className="is-spinning" aria-hidden="true" />Refreshing source state…</div>}
        {!loading && tab === 'changes' && (
          <ChangesView
            files={changedFiles}
            selectedPath={selectedPath}
            selectedPaths={selectedPaths}
            selectedDiff={selectedDiff}
            diffStaged={diffStaged}
            diffLoading={diffLoading}
            commitMessage={commitMessage}
            canMutate={canMutate}
            busyAction={busyAction}
            onSelect={(path) => void loadDiff(path)}
            onSelectStaged={(path) => void loadDiff(path, true)}
            onToggle={(path) => setSelectedPaths((current) => {
              const next = new Set(current)
              if (next.has(path)) next.delete(path)
              else next.add(path)
              return next
            })}
            onStage={(path, stage) => runStage([path], stage, `${stage ? 'stage' : 'unstage'}-${path}`)}
            onStageAll={() => runStage([], true, 'stage-all')}
            onUnstageAll={() => runStage([], false, 'unstage-all')}
            onDiscard={() => {
              if (selectedPathList.length === 0) return
              if (!window.confirm(`Discard ${selectedPathList.length} selected path${selectedPathList.length === 1 ? '' : 's'}? This cannot be undone.`)) return
              void runAction('discard', () => hiveoryClient.discardCodeGit({ workspace_id: workspace.id, relative_paths: selectedPathList, include_untracked: true }))
            }}
            onCommit={() => void runAction('commit', () => hiveoryClient.commitCodeGit({ workspace_id: workspace.id, message: commitMessage }))}
            onCommitMessageChange={setCommitMessage}
          />
        )}
        {!loading && tab === 'branches' && (
          <BranchesView
            repository={repository}
            selectedRemote={selectedRemote}
            branchName={branchName}
            stashMessage={stashMessage}
            canMutate={canMutate}
            busyAction={busyAction}
            onRemoteChange={setSelectedRemote}
            onBranchNameChange={setBranchName}
            onStashMessageChange={setStashMessage}
            onFetch={() => void runAction('fetch', () => hiveoryClient.fetchCodeGit({ workspace_id: workspace.id, remote: selectedRemote, branch: null }))}
            onPull={() => void runAction('pull', () => hiveoryClient.pullCodeGit({ workspace_id: workspace.id, remote: selectedRemote, branch: null }))}
            onPush={() => void runAction('push', () => hiveoryClient.pushCodeGit({ workspace_id: workspace.id, remote: selectedRemote, branch: null }))}
            onCreateBranch={() => void runAction('branch-create', async () => {
              const result = await hiveoryClient.checkoutCodeGitBranch({ workspace_id: workspace.id, name: branchName, create: true, start_point: null })
              setBranchName('')
              return result
            })}
            onCheckout={(name) => void runAction(`checkout-${name}`, () => hiveoryClient.checkoutCodeGitBranch({ workspace_id: workspace.id, name, create: false, start_point: null }))}
            onDelete={(name) => {
              if (!window.confirm(`Delete local branch “${name}”?`)) return
              void runAction(`delete-${name}`, () => hiveoryClient.deleteCodeGitBranch({ workspace_id: workspace.id, name, force: false }))
            }}
            onSaveStash={() => void runAction('stash-save', async () => {
              const result = await hiveoryClient.saveCodeGitStash({ workspace_id: workspace.id, message: stashMessage.trim() || null })
              setStashMessage('')
              return result
            })}
            onPopStash={(index) => void runAction(`stash-pop-${index}`, () => hiveoryClient.popCodeGitStash({ workspace_id: workspace.id, index }))}
            onDropStash={(index) => {
              if (!window.confirm(`Drop stash ${index}?`)) return
              void runAction(`stash-drop-${index}`, () => hiveoryClient.dropCodeGitStash({ workspace_id: workspace.id, index }))
            }}
          />
        )}
        {!loading && tab === 'commits' && <CommitsView commits={repository?.commits ?? []} />}
        {!loading && tab === 'issues' && (
          <IssuesView
            issues={issues}
            ready={hostedReady}
            showForm={showIssueForm}
            title={issueTitle}
            body={issueBody}
            labels={issueLabels}
            busyAction={busyAction}
            onShowForm={() => setShowIssueForm((value) => !value)}
            onTitleChange={setIssueTitle}
            onBodyChange={setIssueBody}
            onLabelsChange={setIssueLabels}
            onCreate={createIssue}
            onAction={(number, action) => void runAction(`issue-${number}-${action}`, () => hiveoryClient.actionCodeHostedIssue({ workspace_id: workspace.id, number, action }))}
          />
        )}
        {!loading && tab === 'pulls' && (
          <PullRequestsView
            pullRequests={pullRequests}
            ready={hostedReady}
            showForm={showPullRequestForm}
            title={pullRequestTitle}
            body={pullRequestBody}
            baseBranch={pullRequestBase}
            draft={pullRequestDraft}
            busyAction={busyAction}
            onShowForm={() => setShowPullRequestForm((value) => !value)}
            onTitleChange={setPullRequestTitle}
            onBodyChange={setPullRequestBody}
            onBaseBranchChange={setPullRequestBase}
            onDraftChange={setPullRequestDraft}
            onCreate={createPullRequest}
            onAction={(number, action) => {
              if (action === 'merge' && !window.confirm(`Merge pull request #${number}?`)) return
              void runAction(`pull-${number}-${action}`, () => hiveoryClient.actionCodeHostedPullRequest({ workspace_id: workspace.id, number, action }))
            }}
          />
        )}
        {!loading && tab === 'checks' && <ChecksView pullRequests={activeChecks} />}
      </div>
    </aside>
  )
}

function EmptyView({ title, detail }: { title: string; detail: string }) {
  return <div className="code-source-empty"><CircleDot size={20} aria-hidden="true" /><strong>{title}</strong><span>{detail}</span></div>
}

interface ChangesViewProps {
  files: CodeGitStatus['files']
  selectedPath: string | null
  selectedPaths: Set<string>
  selectedDiff: CodeGitDiff | null
  diffStaged: boolean
  diffLoading: boolean
  commitMessage: string
  canMutate: boolean
  busyAction: string | null
  onSelect: (path: string) => void
  onSelectStaged: (path: string) => void
  onToggle: (path: string) => void
  onStage: (path: string, stage: boolean) => void
  onStageAll: () => void
  onUnstageAll: () => void
  onDiscard: () => void
  onCommit: () => void
  onCommitMessageChange: (value: string) => void
}

function ChangesView({ files, selectedPath, selectedPaths, selectedDiff, diffStaged, diffLoading, commitMessage, canMutate, busyAction, onSelect, onSelectStaged, onToggle, onStage, onStageAll, onUnstageAll, onDiscard, onCommit, onCommitMessageChange }: ChangesViewProps) {
  const hasStaged = files.some((file) => file.staged)
  const hasUnstaged = files.some((file) => file.unstaged)
  if (files.length === 0) return <EmptyView title="Working tree clean" detail="No staged, unstaged, untracked, or conflicted files were found." />
  return <div className="code-source-changes-view">
    <div className="code-source-change-toolbar">
      <div className="code-source-list-heading"><strong>Working tree</strong><span>{files.length} path{files.length === 1 ? '' : 's'}</span></div>
      <div className="code-source-action-row">
        <button type="button" className="code-source-button" disabled={!canMutate || busyAction !== null || !hasUnstaged} onClick={onStageAll}><Upload size={12} aria-hidden="true" />Stage all</button>
        <button type="button" className="code-source-button is-secondary" disabled={!canMutate || busyAction !== null || !hasStaged} onClick={onUnstageAll}><ArchiveRestore size={12} aria-hidden="true" />Unstage all</button>
        <button type="button" className="code-source-button is-danger" disabled={!canMutate || busyAction !== null || selectedPaths.size === 0} onClick={onDiscard}><Trash2 size={12} aria-hidden="true" />Discard selected</button>
      </div>
    </div>
    <div className="code-source-file-list" role="list" aria-label="Changed files">
      {files.map((file) => <div className={`code-source-file-row ${selectedPath === file.relative_path ? 'is-selected' : ''}`} role="listitem" key={`${file.relative_path}-${file.status}`}>
        <input type="checkbox" checked={selectedPaths.has(file.relative_path)} onChange={() => onToggle(file.relative_path)} aria-label={`Select ${file.relative_path}`} />
        <button type="button" className="code-source-file-main" onClick={() => onSelect(file.relative_path)}>
          <span className={`code-source-file-status ${file.conflict ? 'is-conflict' : file.staged && file.unstaged ? 'is-partial' : file.staged ? 'is-staged' : ''}`}>{file.conflict ? '!' : file.staged && file.unstaged ? '±' : file.staged ? 'S' : 'M'}</span>
          <span>{file.relative_path}</span>
          <small>{normalizeState(file.status)}</small>
        </button>
        <div className="code-source-file-actions">
          {file.staged && <button type="button" className="code-source-mini-button" onClick={() => onSelectStaged(file.relative_path)} title="Show staged diff">Index</button>}
          {file.staged && <button type="button" className="code-source-mini-button" disabled={!canMutate || busyAction !== null} onClick={() => onStage(file.relative_path, false)}>Unstage</button>}
          {file.unstaged && <button type="button" className="code-source-mini-button" disabled={!canMutate || busyAction !== null} onClick={() => onStage(file.relative_path, true)}>Stage</button>}
        </div>
      </div>)}
    </div>
    <div className="code-source-commit-box">
      <input value={commitMessage} onChange={(event) => onCommitMessageChange(event.target.value)} placeholder="Commit message" aria-label="Commit message" maxLength={500} />
      <button type="button" className="code-source-button" disabled={!canMutate || busyAction !== null || !commitMessage.trim() || !hasStaged} onClick={onCommit}><GitCommitHorizontal size={12} aria-hidden="true" />Commit staged</button>
    </div>
    <div className="code-source-diff-view" aria-live="polite">
      <div className="code-source-diff-switcher" role="group" aria-label="Diff source">
        <button type="button" className={!diffStaged ? 'is-selected' : ''} disabled={!selectedPath || diffLoading} onClick={() => selectedPath && onSelect(selectedPath)}>Working tree</button>
        <button type="button" className={diffStaged ? 'is-selected' : ''} disabled={!selectedPath || diffLoading} onClick={() => selectedPath && onSelectStaged(selectedPath)}>Staged index</button>
      </div>
      {!selectedPath && <EmptyView title="Select a file" detail="Choose a changed file to inspect its bounded diff." />}
      {selectedPath && diffLoading && <div className="code-source-loading"><RefreshCw size={15} className="is-spinning" aria-hidden="true" />Loading diff…</div>}
      {selectedPath && !diffLoading && selectedDiff && <><div className="code-source-diff-heading"><FileCode2 size={14} aria-hidden="true" /><strong>{selectedPath}</strong><small>{diffStaged ? 'staged' : 'working tree'}{selectedDiff.truncated ? ' · truncated' : ''}</small></div><pre>{selectedDiff.content || 'No textual diff is available for this file.'}</pre></>}
    </div>
  </div>
}

interface BranchesViewProps {
  repository: CodeGitRepositorySummary | null
  selectedRemote: string | null
  branchName: string
  stashMessage: string
  canMutate: boolean
  busyAction: string | null
  onRemoteChange: (value: string | null) => void
  onBranchNameChange: (value: string) => void
  onStashMessageChange: (value: string) => void
  onFetch: () => void
  onPull: () => void
  onPush: () => void
  onCreateBranch: () => void
  onCheckout: (name: string) => void
  onDelete: (name: string) => void
  onSaveStash: () => void
  onPopStash: (index: number) => void
  onDropStash: (index: number) => void
}

function BranchesView({ repository, selectedRemote, branchName, stashMessage, canMutate, busyAction, onRemoteChange, onBranchNameChange, onStashMessageChange, onFetch, onPull, onPush, onCreateBranch, onCheckout, onDelete, onSaveStash, onPopStash, onDropStash }: BranchesViewProps) {
  if (!repository) return <EmptyView title="Repository details unavailable" detail="Trust the workspace and refresh to inspect branches and worktrees." />
  return <div className="code-source-list-view">
    <div className="code-source-list-heading"><strong>Remote sync</strong><span>{repository.remotes.length} remote{repository.remotes.length === 1 ? '' : 's'}</span></div>
    <div className="code-source-inline-form">
      <select value={selectedRemote ?? ''} onChange={(event) => onRemoteChange(event.target.value || null)} aria-label="Remote">
        <option value="">All remotes / upstream</option>
        {repository.remotes.map((remote) => <option value={remote.name} key={remote.name}>{remote.name}</option>)}
      </select>
      <button type="button" className="code-source-button is-secondary" disabled={!canMutate || busyAction !== null} onClick={onFetch}><CloudDownload size={12} aria-hidden="true" />Fetch</button>
      <button type="button" className="code-source-button is-secondary" disabled={!canMutate || busyAction !== null} onClick={onPull}><CloudDownload size={12} aria-hidden="true" />Pull</button>
      <button type="button" className="code-source-button" disabled={!canMutate || busyAction !== null} onClick={onPush}><CloudUpload size={12} aria-hidden="true" />Push</button>
    </div>
    <div className="code-source-list-heading code-source-subheading"><strong>Local branches</strong><span>{repository.branches.length}</span></div>
    <div className="code-source-inline-form">
      <input value={branchName} onChange={(event) => onBranchNameChange(event.target.value)} placeholder="feature/name" aria-label="New branch name" />
      <button type="button" className="code-source-button" disabled={!canMutate || busyAction !== null || !branchName.trim()} onClick={onCreateBranch}><Plus size={12} aria-hidden="true" />Create & switch</button>
    </div>
    {repository.branches.length === 0 ? <EmptyView title="No local branches" detail="The repository may be empty or detached." /> : repository.branches.map((branch) => <div className="code-source-branch-row" key={branch.name}>
      <GitBranch size={14} aria-hidden="true" /><div><strong>{branch.name}</strong><span>{branchLabel(branch)}</span></div><small>{branch.ahead} ↑ · {branch.behind} ↓</small>
      <div className="code-source-row-actions">{!branch.current && <button type="button" className="code-source-mini-button" disabled={!canMutate || busyAction !== null} onClick={() => onCheckout(branch.name)}>Checkout</button>}{!branch.current && <button type="button" className="code-source-mini-button is-danger" disabled={!canMutate || busyAction !== null} onClick={() => onDelete(branch.name)}>Delete</button>}</div>
    </div>)}
    <div className="code-source-list-heading code-source-subheading"><strong>Stashes</strong><span>{repository.stashes.length}</span></div>
    <div className="code-source-inline-form">
      <input value={stashMessage} onChange={(event) => onStashMessageChange(event.target.value)} placeholder="Optional stash message" aria-label="Stash message" />
      <button type="button" className="code-source-button" disabled={!canMutate || busyAction !== null} onClick={onSaveStash}><Archive size={12} aria-hidden="true" />Save stash</button>
    </div>
    {repository.stashes.length === 0 ? <p className="code-source-muted">No stashes are present.</p> : repository.stashes.map((stash) => <div className="code-source-stash-row" key={stash.oid}><Archive size={13} aria-hidden="true" /><div><strong>stash@&#123;{stash.index}&#125;</strong><span>{stash.message || 'No stash message'} · {stash.oid.slice(0, 8)}</span></div><div className="code-source-row-actions"><button type="button" className="code-source-mini-button" disabled={!canMutate || busyAction !== null} onClick={() => onPopStash(stash.index)}>Apply & drop</button><button type="button" className="code-source-mini-button is-danger" disabled={!canMutate || busyAction !== null} onClick={() => onDropStash(stash.index)}>Drop</button></div></div>)}
    <div className="code-source-list-heading code-source-subheading"><strong>Worktrees</strong><span>{repository.worktrees.length}</span></div>
    {repository.worktrees.length === 0 ? <p className="code-source-muted">No linked worktrees are registered.</p> : repository.worktrees.map((worktree) => <div className="code-source-worktree-row" key={`${worktree.name}-${worktree.path}`}><span className={`code-source-status-dot ${worktree.dirty_files.length ? 'is-warning' : 'is-success'}`} /><div><strong>{worktree.name}</strong><span>{worktree.branch ?? 'detached'} · {worktree.dirty_files.length} changes</span></div><small>{worktree.locked ? 'locked' : 'available'}</small></div>)}
  </div>
}

function CommitsView({ commits }: { commits: CodeGitCommit[] }) {
  if (commits.length === 0) return <EmptyView title="No commits available" detail="Create the first commit or refresh this workspace." />
  return <div className="code-source-list-view">{commits.map((commit) => <div className="code-source-commit-row" key={commit.oid}><GitCommitHorizontal size={14} aria-hidden="true" /><div><strong>{commit.message || 'No commit message'}</strong><span>{commit.short_oid} · {commit.author ?? 'Unknown author'}</span></div><small>{commitDate(commit)}</small></div>)}</div>
}

interface IssuesViewProps {
  issues: CodeHostedIssue[]
  ready: boolean
  showForm: boolean
  title: string
  body: string
  labels: string
  busyAction: string | null
  onShowForm: () => void
  onTitleChange: (value: string) => void
  onBodyChange: (value: string) => void
  onLabelsChange: (value: string) => void
  onCreate: () => void
  onAction: (number: number, action: 'close' | 'reopen') => void
}

function IssuesView({ issues, ready, showForm, title, body, labels, busyAction, onShowForm, onTitleChange, onBodyChange, onLabelsChange, onCreate, onAction }: IssuesViewProps) {
  return <div className="code-source-list-view">
    <div className="code-source-list-heading"><strong>Issues</strong><button type="button" className="code-source-button" disabled={!ready || busyAction !== null} onClick={onShowForm}><Plus size={12} aria-hidden="true" />New issue</button></div>
    {showForm && <div className="code-source-form-card"><input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Issue title" aria-label="Issue title" /><textarea value={body} onChange={(event) => onBodyChange(event.target.value)} placeholder="Describe the issue" aria-label="Issue description" rows={4} /><input value={labels} onChange={(event) => onLabelsChange(event.target.value)} placeholder="Labels, comma separated" aria-label="Issue labels" /><div className="code-source-action-row"><button type="button" className="code-source-button" disabled={busyAction !== null || !title.trim()} onClick={onCreate}><Save size={12} aria-hidden="true" />Create issue</button><button type="button" className="code-source-button is-secondary" onClick={onShowForm}>Cancel</button></div></div>}
    {issues.length === 0 ? <EmptyView title="No issues to show" detail="Issues will appear after hosted-source authentication and repository resolution." /> : issues.map((issue) => <div className="code-source-hosted-row" key={issue.number}><a href={issue.url || undefined} target="_blank" rel="noreferrer" className="code-source-hosted-link"><span className="code-source-hosted-number">#{issue.number}</span><div><strong>{issue.title}</strong><span>{normalizeState(issue.state)} · {issue.author ?? 'Unknown author'}{issue.labels.length ? ` · ${issue.labels.join(', ')}` : ''}</span></div><ExternalLink size={13} aria-hidden="true" /></a><button type="button" className="code-source-mini-button" disabled={!ready || busyAction !== null} onClick={() => onAction(issue.number, issue.state.toLowerCase() === 'open' ? 'close' : 'reopen')}>{issue.state.toLowerCase() === 'open' ? 'Close' : 'Reopen'}</button></div>)}
  </div>
}

interface PullRequestsViewProps {
  pullRequests: CodeHostedPullRequest[]
  ready: boolean
  showForm: boolean
  title: string
  body: string
  baseBranch: string
  draft: boolean
  busyAction: string | null
  onShowForm: () => void
  onTitleChange: (value: string) => void
  onBodyChange: (value: string) => void
  onBaseBranchChange: (value: string) => void
  onDraftChange: (value: boolean) => void
  onCreate: () => void
  onAction: (number: number, action: 'close' | 'reopen' | 'merge') => void
}

function PullRequestsView({ pullRequests, ready, showForm, title, body, baseBranch, draft, busyAction, onShowForm, onTitleChange, onBodyChange, onBaseBranchChange, onDraftChange, onCreate, onAction }: PullRequestsViewProps) {
  return <div className="code-source-list-view">
    <div className="code-source-list-heading"><strong>Pull requests</strong><button type="button" className="code-source-button" disabled={!ready || busyAction !== null} onClick={onShowForm}><Plus size={12} aria-hidden="true" />New pull request</button></div>
    {showForm && <div className="code-source-form-card"><input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Pull request title" aria-label="Pull request title" /><textarea value={body} onChange={(event) => onBodyChange(event.target.value)} placeholder="Describe the changes" aria-label="Pull request description" rows={4} /><input value={baseBranch} onChange={(event) => onBaseBranchChange(event.target.value)} placeholder="Base branch (optional)" aria-label="Base branch" /><label className="code-source-checkbox"><input type="checkbox" checked={draft} onChange={(event) => onDraftChange(event.target.checked)} />Create as draft</label><div className="code-source-action-row"><button type="button" className="code-source-button" disabled={busyAction !== null || !title.trim()} onClick={onCreate}><Save size={12} aria-hidden="true" />Create pull request</button><button type="button" className="code-source-button is-secondary" onClick={onShowForm}>Cancel</button></div></div>}
    {pullRequests.length === 0 ? <EmptyView title="No pull requests to show" detail="Pull requests will appear after hosted-source authentication and repository resolution." /> : pullRequests.map((pullRequest) => <div className="code-source-hosted-row" key={pullRequest.number}><a className="code-source-hosted-link" href={pullRequest.url || undefined} target="_blank" rel="noreferrer"><GitPullRequest size={14} aria-hidden="true" /><div><strong>#{pullRequest.number} {pullRequest.title}</strong><span>{pullRequest.draft ? 'draft · ' : ''}{normalizeState(pullRequest.state)} · {pullRequest.head_branch} → {pullRequest.base_branch} · {pullRequest.author ?? 'Unknown author'}</span></div><span className={`code-source-check-pill ${checkTone(pullRequest.check_state)}`}>{pullRequest.check_state}</span></a><div className="code-source-row-actions">{pullRequest.state.toLowerCase() === 'open' && <button type="button" className="code-source-mini-button" disabled={!ready || busyAction !== null} onClick={() => onAction(pullRequest.number, 'merge')}>Merge</button>}<button type="button" className="code-source-mini-button" disabled={!ready || busyAction !== null} onClick={() => onAction(pullRequest.number, pullRequest.state.toLowerCase() === 'open' ? 'close' : 'reopen')}>{pullRequest.state.toLowerCase() === 'open' ? 'Close' : 'Reopen'}</button></div></div>)}
  </div>
}

function ChecksView({ pullRequests }: { pullRequests: CodeHostedPullRequest[] }) {
  if (pullRequests.length === 0) return <EmptyView title="No check runs to show" detail="Checks are derived from tracked pull requests and refresh with source data." />
  return <div className="code-source-list-view">{pullRequests.map((pullRequest) => <div className="code-source-check-row" key={pullRequest.number}><span className={`code-source-check-icon ${checkTone(pullRequest.check_state)}`}><CheckCircle2 size={14} aria-hidden="true" /></span><div><strong>#{pullRequest.number} {pullRequest.title}</strong><span>{pullRequest.review_decision ? `Review: ${normalizeState(pullRequest.review_decision)}` : 'Review decision unavailable'}</span></div><span className={`code-source-check-pill ${checkTone(pullRequest.check_state)}`}>{pullRequest.check_state}</span></div>)}</div>
}
