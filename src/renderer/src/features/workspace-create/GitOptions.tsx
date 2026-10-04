import { useEffect, useState } from 'react'
import { GitBranch, GitCommitHorizontal } from 'lucide-react'
import type { GitInfo } from '@shared/domain/github'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { TextField } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import formStyles from '../../components/ui/form.module.css'
import { api } from '../../lib/api'
import { useProjects } from '../../stores/data'
import { runAction } from '../../stores/notices'
import styles from './CreateWorkspaceDialog.module.css'

export interface GitChoice {
  baseRef?: string
  branch?: string
  useExistingBranch: boolean
  /** Repository can host an isolated workspace and the inputs are valid. */
  ready: boolean
}

interface GitOptionsProps {
  projectId: string
  /** Suggested branch name (from the workspace name), shown until the user edits it. */
  suggestedBranch: string
  onChange: (choice: GitChoice) => void
}

/**
 * Branch options for an isolated workspace: base branch, branch name, or an
 * existing branch. Folders that are not Git repositories yet get a one-click
 * "Initialize Git" so isolation is always reachable.
 */
export function GitOptions({ projectId, suggestedBranch, onChange }: GitOptionsProps) {
  const [info, setInfo] = useState<GitInfo | null>(null)
  const [baseRef, setBaseRef] = useState<string | null>(null)
  const [typedBranch, setTypedBranch] = useState<string | null>(null)
  const [useExisting, setUseExisting] = useState(false)
  const [existing, setExisting] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const loadProjects = useProjects((s) => s.load)

  const refresh = (): Promise<void> =>
    runAction('Read repository', () => api('git.info', { projectId })).then((next) => {
      if (next) setInfo(next)
    })

  useEffect(() => {
    void runAction('Read repository', () => api('git.info', { projectId })).then((next) => {
      if (next) setInfo(next)
    })
  }, [projectId])

  const branch = typedBranch ?? suggestedBranch
  const base = baseRef ?? info?.defaultBranch ?? info?.branches[0] ?? ''
  const free = info?.branches.filter((b) => !info.branchesInUse.includes(b)) ?? []
  const chosenExisting = existing ?? free[0] ?? ''
  const ready = Boolean(info?.isRepo && info.hasCommits)

  // Validate a new branch name against Git itself, debounced.
  useEffect(() => {
    if (!ready || useExisting) return
    const timer = setTimeout(() => {
      void api('git.validateBranch', { projectId, name: branch })
        .then((r) => setProblem(r.problem))
        .catch(() => setProblem(null))
    }, 250)
    return () => clearTimeout(timer)
  }, [projectId, branch, ready, useExisting])

  useEffect(() => {
    onChange(
      useExisting
        ? { useExistingBranch: true, branch: chosenExisting || undefined, ready: ready && Boolean(chosenExisting) }
        : { useExistingBranch: false, baseRef: base || undefined, branch: branch || undefined, ready: ready && !problem && Boolean(branch) }
    )
  }, [useExisting, chosenExisting, base, branch, problem, ready, onChange])

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
            Isolated workspaces are Git branches. Hiveory can {info.isRepo ? 'record a first commit' : 'initialize Git and record a first commit'} of the
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
      <div className={styles.gitToggle}>
        <span className={styles.kindText}>
          <GitBranch aria-hidden /> Use an existing branch
        </span>
        <Toggle label="Use an existing branch" checked={useExisting} onChange={setUseExisting} />
      </div>
      {useExisting ? (
        <Select
          label="Branch to check out"
          value={chosenExisting}
          onChange={setExisting}
          options={
            free.length
              ? free.map((b) => ({ value: b, label: b }))
              : [{ value: '', label: 'Every branch is already checked out somewhere', disabled: true }]
          }
        />
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
