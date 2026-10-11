import { useEffect, useState } from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import type { GitInfo } from '@shared/domain/github'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { TextField } from '../../components/ui/TextField'
import formStyles from '../../components/ui/form.module.css'
import { api } from '../../lib/api'
import { useProjects } from '../../stores/data'
import { runAction } from '../../stores/notices'
import styles from './CreateWorkspaceDialog.module.css'

/** Where a new worktree's branch comes from (ADR 0038): a new branch, one you have, or one on the remote. */
export type WorktreeSource = 'new' | 'existing' | 'remote'

export interface GitChoice {
  baseRef?: string
  branch?: string
  useExistingBranch: boolean
  /** A remote branch (origin/x) to check out as a local branch following it. */
  remoteBranch?: string
  /** Repository can host an isolated workspace and the inputs are valid. */
  ready: boolean
}

interface GitOptionsProps {
  projectId: string
  source: WorktreeSource
  /** Suggested branch name (from the workspace name), shown until the user edits it. */
  suggestedBranch: string
  /** The Workspace's own base branch (ADR 0037), when it exists in this repository. */
  defaultBase?: string
  onChange: (choice: GitChoice) => void
}

/**
 * Branch options for a new worktree, by source: a base branch and a new branch name, an existing
 * local branch, or a remote branch (fetched first). Folders that are not Git repositories yet get
 * a one-click "Initialize Git" so isolation is always reachable.
 */
export function GitOptions({ projectId, source, suggestedBranch, defaultBase, onChange }: GitOptionsProps) {
  const [info, setInfo] = useState<GitInfo | null>(null)
  const [baseRef, setBaseRef] = useState<string | null>(null)
  const [typedBranch, setTypedBranch] = useState<string | null>(null)
  const useExisting = source === 'existing'
  const [existing, setExisting] = useState<string | null>(null)
  const [remote, setRemote] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const loadProjects = useProjects((s) => s.load)

  // Remote branches are fetched first, so the list matches what is on GitHub now.
  const refresh = (): Promise<void> =>
    runAction('Read repository', () => api('git.info', { projectId, fetch: source === 'remote' })).then((next) => {
      if (next) setInfo(next)
    })

  useEffect(() => {
    void runAction('Read repository', () => api('git.info', { projectId, fetch: source === 'remote' })).then((next) => {
      if (next) setInfo(next)
    })
  }, [projectId, source])

  const branch = typedBranch ?? suggestedBranch
  const base = baseRef ?? (defaultBase && info?.branches.includes(defaultBase) ? defaultBase : undefined) ?? info?.defaultBranch ?? info?.branches[0] ?? ''
  const free = info?.branches.filter((b) => !info.branchesInUse.includes(b)) ?? []
  const chosenExisting = existing ?? free[0] ?? ''
  // A remote branch whose local copy is checked out elsewhere can't get a second worktree.
  const remotes = info?.remoteBranches.filter((r) => !info.branchesInUse.includes(r.slice(r.indexOf('/') + 1))) ?? []
  const chosenRemote = remote ?? remotes[0] ?? ''
  const ready = Boolean(info?.isRepo && info.hasCommits)

  // Validate a new branch name against Git itself, debounced.
  useEffect(() => {
    if (!ready || source !== 'new') return
    const timer = setTimeout(() => {
      void api('git.validateBranch', { projectId, name: branch })
        .then((r) => setProblem(r.problem))
        .catch(() => setProblem(null))
    }, 250)
    return () => clearTimeout(timer)
  }, [projectId, branch, ready, source])

  useEffect(() => {
    onChange(
      source === 'remote'
        ? { useExistingBranch: false, remoteBranch: chosenRemote || undefined, ready: ready && Boolean(chosenRemote) }
        : useExisting
          ? { useExistingBranch: true, branch: chosenExisting || undefined, ready: ready && Boolean(chosenExisting) }
          : { useExistingBranch: false, baseRef: base || undefined, branch: branch || undefined, ready: ready && !problem && Boolean(branch) }
    )
  }, [source, useExisting, chosenExisting, chosenRemote, base, branch, problem, ready, onChange])

  const init = async (): Promise<void> => {
    setInitializing(true)
    const project = await runAction('Initialize Git', () => api('git.init', { projectId, commit: true }))
    setInitializing(false)
    if (project) {
      await loadProjects()
      await refresh()
    }
  }

  if (!info) return <p className={formStyles.fieldHint}>Reading repository…</p>

  if (!ready) {
    return (
      <div className={styles.gitSetup}>
        <GitCommitHorizontal className={styles.gitSetupIcon} aria-hidden />
        <div className={styles.gitSetupText}>
          <span className={styles.kindTitle}>{info.isRepo ? 'This repository has no commits yet' : 'This folder is not a Git repository'}</span>
          <span className={styles.kindText}>
            Isolated worktrees are Git branches. Hiveory can {info.isRepo ? 'record a first commit' : 'initialize Git and record a first commit'} of the
            current files for you.
          </span>
        </div>
        <Button variant="primary" loading={initializing} onClick={() => void init()}>
          {info.isRepo ? 'Create first commit' : 'Initialize Git'}
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.gitOptions}>
      {source === 'remote' ? (
        <>
          <Select
            label="Remote branch"
            value={chosenRemote}
            onChange={setRemote}
            options={
              remotes.length
                ? remotes.map((b) => ({ value: b, label: b }))
                : [{ value: '', label: info.remoteBranches.length ? 'Every remote branch is already checked out here' : 'No remote branches', disabled: true }]
            }
          />
          <span className={formStyles.fieldHint}>
            {info.fetchFailed
              ? info.remoteBranches.length
                ? 'Could not reach the remote; showing the branches Git knew already.'
                : 'This repository has no remote Hiveory could reach (origin).'
              : 'Checked out as a local branch of the same name that follows it.'}
          </span>
        </>
      ) : useExisting ? (
        <>
          <Select
            label="Branch to check out"
            value={chosenExisting}
            onChange={setExisting}
            options={
              free.length
                ? free.map((b) => ({ value: b, label: b }))
                : [{ value: '', label: 'No branch is free to check out', disabled: true }]
            }
          />
          {/* Git checks a branch out in one folder at a time; say why the list is empty (ADR 0039). */}
          {!free.length && (
            <span className={formStyles.fieldHint}>
              {info.branches.length
                ? `Every local branch (${info.branches.join(', ')}) is already open in a worktree. Use New branch, or Remote branch for one on GitHub.`
                : 'This repository has no local branches yet.'}
            </span>
          )}
        </>
      ) : (
        <div className={styles.gitRow}>
          <Select
            label="Base branch"
            value={base}
            onChange={setBaseRef}
            options={info.branches.map((b) => ({ value: b, label: b === info.defaultBranch ? `${b} (default)` : b }))}
          />
          <div className={styles.gitBranchField}>
            <TextField label="New branch" value={branch} onChange={setTypedBranch} maxLength={120} spellCheck={false} />
            {problem && <span className={formStyles.fieldError}>{problem}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
