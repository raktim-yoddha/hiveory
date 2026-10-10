import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { Download, Folder, FolderOpen, Plus } from 'lucide-react'
import type { Project } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { TextField, TextInput } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { usePlatform } from '../../lib/platform'
import { useApp, useProjects } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { RemoteFolderPicker, SSH_DESTINATION } from './RemoteFolderPicker'
import styles from './AddProjectDialog.module.css'

type Mode = 'folder' | 'create' | 'clone'
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
  { id: 'clone', label: 'Clone repository', icon: <Download aria-hidden /> }
]

/**
 * Add workspace (ADR 0020, ADR 0022, ADR 0038): Remote picks a folder on an SSH host. Local offers
 * three ways in — pick a folder, create a new repository (optionally on GitHub), or clone one.
 * Its Primary and every worktree Git knows come with it; a folder added before comes back whole.
 * Folders are always chosen with main's picker.
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
  const [busy, setBusy] = useState(false)
  const [where, setWhere] = useState<'local' | 'remote'>('local')
  const [destination, setDestination] = useState('')
  const [remoteFolder, setRemoteFolder] = useState('')

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
  }

  const choose = async (purpose: 'project' | 'parent'): Promise<void> => {
    const picked = await api('projects.pickFolder', { purpose }).catch(() => null)
    if (!picked) return
    if (purpose === 'project') setFolder(picked)
    else setParentDir(picked)
  }

  const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const cloneName = url.trim().replace(/[/\\]+$/, '').replace(/\.git$/i, '').split(/[/:]/).filter(Boolean).at(-1) ?? ''
  const suggested = where === 'remote' ? folderName(remoteFolder) : mode === 'folder' ? folderName(folder) : mode === 'create' ? repoName : cloneName

  const ready = where === 'remote'
    ? SSH_DESTINATION.test(destination.trim()) && /^(\/|~)/.test(remoteFolder.trim())
    : mode === 'folder'
      ? Boolean(folder)
      : mode === 'create'
        ? /^[A-Za-z0-9._-]{1,100}$/.test(repoName) && Boolean(parentDir) && (!onGithub || Boolean(owner))
        : url.trim().length > 3 && Boolean(parentDir)

  const submit = (): void => {
    if (!ready || busy) return
    setBusy(true)
    const label = where === 'remote' ? 'Add remote workspace' : { folder: 'Add workspace', create: 'Create repository', clone: 'Clone repository' }[mode]
    const custom = name.trim() || undefined
    void runAction(label, async (): Promise<Project> => {
      if (where === 'remote') return api('projects.add', { mode: 'remote', destination: destination.trim(), path: remoteFolder.trim(), name: custom })
      if (mode === 'folder') return api('projects.add', { mode: 'folder', path: folder, name: custom })
      if (mode === 'clone') return api('projects.add', { mode: 'clone', url: url.trim(), parentDir, name: custom })
      return api('projects.add', { mode: 'create', repoName, parentDir, name: custom, ...(onGithub ? { github: { owner, visibility } } : {}) })
    })
      .then(async (project) => {
        if (!project) return
        await useProjects.getState().load()
        useNavigation.getState().openProject(project.id)
        close()
      })
      .finally(() => setBusy(false))
  }

  // A window using a Hiveory server has no folder picker on that machine: its folders are typed.
  const onServer = Boolean(useApp.getState().info?.client)
  const pathRow = (label: string, value: string, empty: string, purpose: 'project' | 'parent') =>
    onServer ? (
      <TextField label={`${label} on the server`} value={value} placeholder="/home/me/app" onChange={purpose === 'project' ? setFolder : setParentDir} />
    ) : (
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

  const submitLabel = where === 'remote' ? 'Add workspace' : { folder: 'Add workspace', create: 'Create', clone: 'Clone' }[mode]

  return (
    <Modal
      open={open}
      title="Add workspace"
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
            aria-label="Workspace name"
            placeholder={suggested || 'Workspace name'}
            value={name}
            onChange={setName}
          />
          <div className={styles.where}>
            <Select
              label="Where the workspace lives"
              hideLabel
              value={where}
              options={[
                { value: 'local', label: 'Local' },
                { value: 'remote', label: 'Remote (SSH)' }
              ]}
              onChange={(v) => setWhere(v as 'local' | 'remote')}
            />
          </div>
        </div>

        {where === 'remote' && (
          <RemoteFolderPicker destination={destination} onDestination={setDestination} folder={remoteFolder} onFolder={setRemoteFolder} />
        )}

        {where === 'local' && (
          <>
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
                {pathRow('Workspace directory', parentDir, 'Choose where it goes', 'parent')}
              </>
            )}

            {mode === 'clone' && (
              <>
                <TextField label="Repository URL" value={url} onChange={setUrl} placeholder="https://github.com/owner/repo.git" />
                {pathRow('Workspace directory', parentDir, 'Choose where it goes', 'parent')}
              </>
            )}

          </>
        )}
      </div>
    </Modal>
  )
}
