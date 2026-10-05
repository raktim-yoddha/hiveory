import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { ArchiveRestore, Download, Folder, FolderOpen, Plus } from 'lucide-react'
import type { PreviousProject, Project } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { TextField, TextInput } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { usePlatform } from '../../lib/platform'
import { useProjects } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import styles from './AddProjectDialog.module.css'

type Mode = 'folder' | 'create' | 'clone' | 'previous'
type Defaults = Awaited<ReturnType<typeof loadDefaults>>
const loadDefaults = () => api('projects.addDefaults')

/** Whether the Add project dialog is showing. Every "add project" entry point opens it (never a bare folder picker). */
export const useAddProject = create<{ open: boolean; mode: Mode; show(mode?: Mode): void; setMode(mode: Mode): void; hide(): void }>((set) => ({
  open: false,
  mode: 'folder',
  show: (mode = 'folder') => set({ open: true, mode }),
  setMode: (mode) => set({ mode }),
  hide: () => set({ open: false })
}))

const MODES: Array<{ id: Mode; label: string; icon: ReactNode }> = [
  { id: 'folder', label: 'Pick directory', icon: <FolderOpen aria-hidden /> },
  { id: 'create', label: 'New repository', icon: <Plus aria-hidden /> },
  { id: 'clone', label: 'Clone repository', icon: <Download aria-hidden /> },
  { id: 'previous', label: 'Restore previous', icon: <ArchiveRestore aria-hidden /> }
]

const ago = (iso?: string): string => {
  if (!iso) return ''
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Add project (ADR 0020): Local or Remote (not available yet), then one of four
 * ways in — pick a folder, create a new repository (optionally on GitHub), clone
 * one, or restore a project removed earlier (with its workspaces and agents) or
 * workspace folders found on disk. Folders are always chosen with main's picker.
 */
export function AddProjectDialog() {
  const { open, hide, mode, setMode } = useAddProject()
  const platform = usePlatform()
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [repoName, setRepoName] = useState('')
  const [url, setUrl] = useState('')
  const [onGithub, setOnGithub] = useState(false)
  const [owner, setOwner] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [previous, setPrevious] = useState<PreviousProject[] | null>(null)
  const [restoring, setRestoring] = useState('')
  const [busy, setBusy] = useState(false)

  // Fresh each time it opens: defaults (and the GitHub account), and what can be restored.
  useEffect(() => {
    if (!open) return
    let live = true
    loadDefaults()
      .then((d) => {
        if (!live) return
        setDefaults(d)
        setParentDir((p) => p || d.parentDir)
        setOwner((o) => o || d.github.owners[0] || '')
      })
      .catch(() => undefined)
    api('projects.previous')
      .then((list) => live && setPrevious(list))
      .catch(() => live && setPrevious([]))
    return () => {
      live = false
    }
  }, [open])

  const close = (): void => {
    hide()
    setName('')
    setFolder('')
    setRepoName('')
    setUrl('')
    setRestoring('')
  }

  const choose = async (purpose: 'project' | 'parent'): Promise<void> => {
    const picked = await api('projects.pickFolder', { purpose }).catch(() => null)
    if (!picked) return
    if (purpose === 'project') setFolder(picked)
    else setParentDir(picked)
  }

  const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const cloneName = url.trim().replace(/[/\\]+$/, '').replace(/\.git$/i, '').split(/[/:]/).filter(Boolean).at(-1) ?? ''
  const suggested = mode === 'folder' ? folderName(folder) : mode === 'create' ? repoName : mode === 'clone' ? cloneName : ''
  const target = previous?.find((p) => p.path === restoring)

  const ready =
    mode === 'folder'
      ? Boolean(folder)
      : mode === 'create'
        ? /^[A-Za-z0-9._-]{1,100}$/.test(repoName) && Boolean(parentDir) && (!onGithub || Boolean(owner))
        : mode === 'clone'
          ? url.trim().length > 3 && Boolean(parentDir)
          : Boolean(target && !target.missing)

  const submit = (): void => {
    if (!ready || busy) return
    setBusy(true)
    const label = { folder: 'Add project', create: 'Create repository', clone: 'Clone repository', previous: 'Restore project' }[mode]
    const custom = name.trim() || undefined
    void runAction(label, async (): Promise<Project> => {
      if (mode === 'previous') return api('projects.restore', { path: restoring })
      if (mode === 'folder') return api('projects.add', { mode: 'folder', path: folder, name: custom })
      if (mode === 'clone') return api('projects.add', { mode: 'clone', url: url.trim(), parentDir, name: custom })
      return api('projects.add', { mode: 'create', repoName, parentDir, name: custom, ...(onGithub ? { github: { owner, visibility } } : {}) })
    })
      .then(async (project) => {
        if (!project) return
        await useProjects.getState().load()
        useNavigation.getState().openProject(project.id, mode === 'previous' ? 'workspaces' : 'tasks')
        close()
      })
      .finally(() => setBusy(false))
  }

  const pathRow = (label: string, value: string, empty: string, purpose: 'project' | 'parent') => (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={cx(styles.path, !value && styles.pathEmpty)}>
        <Folder aria-hidden />
        <span className={styles.pathText} title={value}>
          {value || empty}
        </span>
        <Button size="sm" variant="secondary" onClick={() => void choose(purpose)}>
          Choose
        </Button>
      </div>
    </div>
  )

  const submitLabel = { folder: 'Add project', create: 'Create', clone: 'Clone', previous: target?.projectId ? 'Restore workspaces' : 'Restore' }[mode]

  return (
    <Modal
      open={open}
      title="Add project"
      width="lg"
      onClose={close}
      footer={
        <Button variant="primary" loading={busy} disabled={!ready} onClick={submit} className={styles.submit}>
          {submitLabel}
          <kbd className={styles.kbd}>{platform === 'darwin' ? '⌘' : 'Ctrl'} ⏎</kbd>
        </Button>
      }
    >
      <div
        className={styles.body}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
      >
        <div className={styles.top}>
          <TextInput
            className={styles.name}
            aria-label="Project name"
            placeholder={suggested || 'Project name'}
            value={name}
            onChange={setName}
            disabled={mode === 'previous'}
          />
          <div className={styles.where}>
            <Select
              label="Where the project lives"
              hideLabel
              value="local"
              options={[
                { value: 'local', label: 'Local' },
                { value: 'remote', label: 'Remote · coming soon', disabled: true }
              ]}
              onChange={() => undefined}
            />
          </div>
        </div>

        <div className={styles.modes} role="radiogroup" aria-label="How to add it">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={cx(styles.mode, mode === m.id && styles.modeOn)} onClick={() => setMode(m.id)}>
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'folder' && pathRow('Directory', folder, 'Select a directory', 'project')}

        {mode === 'create' && (
          <>
            <TextField label="Repository name" value={repoName} onChange={(v) => setRepoName(v.replace(/\s+/g, '-'))} placeholder="Enter a repository name" />
            <div className={styles.github}>
              <div className={styles.githubHead}>
                <div>
                  <span className={styles.label}>Also create it on GitHub</span>
                  <span className={styles.note}>
                    {defaults?.github.available
                      ? `Signed in to the GitHub CLI as @${defaults.github.login}.`
                      : (defaults?.github.reason ?? 'Checking the GitHub CLI…')}
                  </span>
                </div>
                <Toggle label="Also create it on GitHub" checked={onGithub} disabled={!defaults?.github.available} onChange={setOnGithub} />
              </div>
              {onGithub && defaults?.github.available && (
                <div className={styles.githubRow}>
                  <Select label="Owner" value={owner} options={defaults.github.owners.map((o) => ({ value: o, label: o }))} onChange={setOwner} />
                  <Select
                    label="Visibility"
                    value={visibility}
                    options={[
                      { value: 'private', label: 'Private' },
                      { value: 'public', label: 'Public' }
                    ]}
                    onChange={(v) => setVisibility(v as 'private' | 'public')}
                  />
                </div>
              )}
            </div>
            {pathRow('Project directory', parentDir, 'Choose where it goes', 'parent')}
          </>
        )}

        {mode === 'clone' && (
          <>
            <TextField label="Repository URL" value={url} onChange={setUrl} placeholder="https://github.com/owner/repo.git" />
            {pathRow('Project directory', parentDir, 'Choose where it goes', 'parent')}
          </>
        )}

        {mode === 'previous' && (
          <div className={styles.previous}>
            <span className={styles.note}>
              Projects you removed come back whole: workspaces, agents (resuming their conversations), layouts and open files. Workspace folders found
              on disk come back as workspaces.
            </span>
            {previous === null ? null : previous.length === 0 ? (
              <p className={styles.none}>Nothing to restore. Removed projects and leftover workspace folders show up here.</p>
            ) : (
              <ul className={styles.list} role="radiogroup" aria-label="Restore which">
                {previous.map((p) => (
                  <li key={`${p.source}:${p.path}`}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={restoring === p.path}
                      disabled={p.missing}
                      className={cx(styles.item, restoring === p.path && styles.itemOn)}
                      onClick={() => setRestoring(p.path)}
                    >
                      <span className={styles.itemTop}>
                        <span className={styles.itemName}>{p.name}</span>
                        <span className={styles.badge}>{p.missing ? 'Folder missing' : p.source === 'removed' ? `Removed ${ago(p.removedAt)}` : p.projectId ? 'Open now' : 'Found on disk'}</span>
                      </span>
                      <span className={styles.itemPath} title={p.path}>
                        {p.path}
                      </span>
                      <span className={styles.itemMeta}>
                        {plural(p.workspaces.length, 'workspace')}
                        {p.workspaces.length ? `: ${p.workspaces.slice(0, 4).join(', ')}${p.workspaces.length > 4 ? '…' : ''}` : ''}
                        {p.agents ? ` · ${plural(p.agents, 'agent')}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
