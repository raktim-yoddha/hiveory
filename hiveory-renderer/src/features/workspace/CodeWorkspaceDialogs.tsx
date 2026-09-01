import React, { useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, FolderOpen, FolderTree, GitBranch, Layers3, Pencil, X } from 'lucide-react'
import type {
  CodeProjectSummary,
  CodeWorkspaceCreateRequest,
  CodeWorkspaceParentRequest,
  CodeWorkspaceSummary,
  CodeWorkspaceUpdateRequest,
} from '../../shared/api/hiveory-client'

interface CodeWorkspaceCreateDialogProps {
  open: boolean
  projects: CodeProjectSummary[]
  activeProjectId: string | null
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (request: CodeWorkspaceCreateRequest) => void
}

export const CodeWorkspaceCreateDialog: React.FC<CodeWorkspaceCreateDialogProps> = ({
  open,
  projects,
  activeProjectId,
  busy,
  error,
  onClose,
  onSubmit,
}) => {
  const availableProjects = useMemo(() => projects.filter((project) => project.available), [projects])
  const [projectId, setProjectId] = useState(activeProjectId ?? availableProjects[0]?.id ?? '')
  const [name, setName] = useState('')
  const [branchName, setBranchName] = useState('')

  useEffect(() => {
    if (!open) return
    setProjectId(activeProjectId && availableProjects.some((project) => project.id === activeProjectId) ? activeProjectId : availableProjects[0]?.id ?? '')
    setName('')
    setBranchName('')
  }, [activeProjectId, availableProjects, open])

  if (!open) return null

  const selectedProject = availableProjects.find((project) => project.id === projectId) ?? null
  const defaultBranch = name.trim() ? `workspace/${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'}` : 'workspace/<name>'

  return (
    <div className="code-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="code-project-dialog" role="dialog" aria-modal="true" aria-labelledby="code-create-workspace-title">
        <header className="code-project-dialog-header">
          <div><div className="code-dialog-icon"><BriefcaseBusiness size={17} aria-hidden="true" /></div><div><p className="code-dialog-eyebrow">New isolated workspace</p><h2 id="code-create-workspace-title">Add workspace</h2></div></div>
          <button type="button" className="code-dialog-close" onClick={onClose} aria-label="Close dialog"><X size={17} aria-hidden="true" /></button>
        </header>
        <p className="code-dialog-description">Create an isolated workspace with its own branch and durable pane layout. The project folder remains unchanged.</p>
        <div className="code-dialog-form">
          <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={busy}>
            <option value="" disabled>Select a project</option>
            {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.display_name}</option>)}
          </select></label>
          <label>Workspace name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Feature branch" disabled={busy} /></label>
          <label>Branch name<input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder={defaultBranch} disabled={busy} /><small>Leave empty to use {defaultBranch}.</small></label>
          <div className="code-dialog-base-ref"><GitBranch size={14} aria-hidden="true" /><span><strong>Base</strong><small>Current project HEAD</small></span></div>
        </div>
        {selectedProject && <p className="code-dialog-path-preview">Project: <code>{selectedProject.root_path}</code></p>}
        {error && <p className="code-dialog-error" role="alert">{error}</p>}
        <footer className="code-dialog-actions">
          <button type="button" className="code-secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="code-primary-button" onClick={() => onSubmit({ project_id: projectId, name, base_ref: 'HEAD', branch_name: branchName.trim() || null })} disabled={busy || !projectId || !name.trim()}>
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </footer>
      </section>
    </div>
  )
}

interface CodeProjectSettingsDialogProps {
  open: boolean
  project: CodeProjectSummary | null
  onClose: () => void
}

export const CodeProjectSettingsDialog: React.FC<CodeProjectSettingsDialogProps> = ({ open, project, onClose }) => {
  if (!open || !project) return null

  return (
    <div className="code-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="code-project-dialog code-project-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="code-project-settings-title">
        <header className="code-project-dialog-header">
          <div><div className="code-dialog-icon"><FolderOpen size={17} aria-hidden="true" /></div><div><p className="code-dialog-eyebrow">Project</p><h2 id="code-project-settings-title">Project Settings</h2></div></div>
          <button type="button" className="code-dialog-close" onClick={onClose} aria-label="Close dialog"><X size={17} aria-hidden="true" /></button>
        </header>
        <p className="code-dialog-description">Project identity is anchored to this folder. Workspace panes and app-managed worktrees remain separate children of the project.</p>
        <div className="code-project-settings-list">
          <div><FolderOpen size={14} aria-hidden="true" /><span><strong>Root folder</strong><small>{project.root_path}</small></span></div>
          <div><GitBranch size={14} aria-hidden="true" /><span><strong>Repository</strong><small>{project.repository_name ?? 'Folder project'} · {project.current_branch ?? 'No active branch'}</small></span></div>
          <div><Layers3 size={14} aria-hidden="true" /><span><strong>Workspaces</strong><small>{project.workspace_count} registered workspace{project.workspace_count === 1 ? '' : 's'}</small></span></div>
        </div>
        <footer className="code-dialog-actions">
          <button type="button" className="code-secondary-button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  )
}

interface CodeWorkspaceRenameDialogProps {
  open: boolean
  workspace: CodeWorkspaceSummary | null
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (request: CodeWorkspaceUpdateRequest) => void
}

export const CodeWorkspaceRenameDialog: React.FC<CodeWorkspaceRenameDialogProps> = ({ open, workspace, busy, error, onClose, onSubmit }) => {
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName(workspace?.display_name ?? '')
  }, [open, workspace])

  if (!open || !workspace) return null
  const titleId = 'code-update-workspace-title'

  return (
    <div className="code-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="code-project-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="code-project-dialog-header">
          <div><div className="code-dialog-icon"><Pencil size={17} aria-hidden="true" /></div><div><p className="code-dialog-eyebrow">Workspace</p><h2 id={titleId}>Update workspace</h2></div></div>
          <button type="button" className="code-dialog-close" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={17} aria-hidden="true" /></button>
        </header>
        <p className="code-dialog-description">Change the label shown in the workspace rail. The folder, branch, and pane layout stay unchanged.</p>
        <div className="code-dialog-form">
          <label>Workspace name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} disabled={busy} maxLength={80} /></label>
        </div>
        <p className="code-dialog-path-preview">Folder: <code>{workspace.root_path}</code></p>
        {error && <p className="code-dialog-error" role="alert">{error}</p>}
        <footer className="code-dialog-actions">
          <button type="button" className="code-secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="code-primary-button" onClick={() => onSubmit({ workspace_id: workspace.id, display_name: name })} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save changes'}</button>
        </footer>
      </section>
    </div>
  )
}

interface CodeProjectGroupDialogProps {
  open: boolean
  project: CodeProjectSummary | null
  currentGroup: string | null
  onClose: () => void
  onSubmit: (groupName: string | null) => void
}

export const CodeProjectGroupDialog: React.FC<CodeProjectGroupDialogProps> = ({ open, project, currentGroup, onClose, onSubmit }) => {
  const [name, setName] = useState(currentGroup ?? '')

  useEffect(() => {
    if (open) setName(currentGroup ?? '')
  }, [currentGroup, open])

  if (!open || !project) return null
  const titleId = 'code-project-group-title'
  return (
    <div className="code-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="code-project-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="code-project-dialog-header">
          <div><div className="code-dialog-icon"><FolderTree size={17} aria-hidden="true" /></div><div><p className="code-dialog-eyebrow">Project organization</p><h2 id={titleId}>Project group</h2></div></div>
          <button type="button" className="code-dialog-close" onClick={onClose} aria-label="Close dialog"><X size={17} aria-hidden="true" /></button>
        </header>
        <p className="code-dialog-description">Give this project a short group label. The label is stored locally on this device and appears beside the project in the rail.</p>
        <div className="code-dialog-form">
          <label>Group name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Client work" maxLength={40} /></label>
        </div>
        <p className="code-dialog-path-preview">Project: <code>{project.display_name}</code></p>
        <footer className="code-dialog-actions">
          {currentGroup && <button type="button" className="code-danger-button" onClick={() => onSubmit(null)}>Remove group</button>}
          <button type="button" className="code-secondary-button" onClick={onClose}>Cancel</button>
          <button type="button" className="code-primary-button" onClick={() => onSubmit(name.trim() || null)} disabled={!name.trim()}>Save group</button>
        </footer>
      </section>
    </div>
  )
}

interface CodeParentWorkspaceDialogProps {
  open: boolean
  workspace: CodeWorkspaceSummary | null
  candidates: CodeWorkspaceSummary[]
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (request: CodeWorkspaceParentRequest) => void
}

export const CodeParentWorkspaceDialog: React.FC<CodeParentWorkspaceDialogProps> = ({ open, workspace, candidates, busy, error, onClose, onSubmit }) => {
  const [parentId, setParentId] = useState('')

  useEffect(() => {
    if (open) setParentId(workspace?.parent_workspace_id ?? '')
  }, [open, workspace])

  if (!open || !workspace) return null
  const titleId = 'code-parent-workspace-title'
  return (
    <div className="code-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="code-project-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="code-project-dialog-header">
          <div><div className="code-dialog-icon"><GitBranch size={17} aria-hidden="true" /></div><div><p className="code-dialog-eyebrow">Workspace hierarchy</p><h2 id={titleId}>Set parent worktree</h2></div></div>
          <button type="button" className="code-dialog-close" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={17} aria-hidden="true" /></button>
        </header>
        <p className="code-dialog-description">Use a parent to keep related workspaces together. Parent and child must belong to the same project; clearing the selection returns this workspace to the project root.</p>
        <div className="code-dialog-form">
          <label>Parent workspace<select autoFocus value={parentId} onChange={(event) => setParentId(event.target.value)} disabled={busy}>
            <option value="">No parent — project root</option>
            {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.display_name}{candidate.workspace_kind === 'primary' ? ' · primary' : ''}</option>)}
          </select></label>
        </div>
        <p className="code-dialog-path-preview">Workspace: <code>{workspace.display_name}</code></p>
        {error && <p className="code-dialog-error" role="alert">{error}</p>}
        <footer className="code-dialog-actions">
          <button type="button" className="code-secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="code-primary-button" onClick={() => onSubmit({ workspace_id: workspace.id, parent_workspace_id: parentId || null })} disabled={busy}>{busy ? 'Saving…' : 'Save relationship'}</button>
        </footer>
      </section>
    </div>
  )
}
