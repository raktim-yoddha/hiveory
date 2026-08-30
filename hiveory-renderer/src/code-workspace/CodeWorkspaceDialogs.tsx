import React, { useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, FolderOpen, GitBranch, Layers3, X } from 'lucide-react'
import type {
  CodeProjectSummary,
  CodeWorkspaceCreateRequest,
} from '../api/hiveory-client'

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
  const gitProjects = useMemo(() => projects.filter((project) => project.kind === 'git' && project.available), [projects])
  const [projectId, setProjectId] = useState(activeProjectId ?? gitProjects[0]?.id ?? '')
  const [name, setName] = useState('')
  const [branchName, setBranchName] = useState('')

  useEffect(() => {
    if (!open) return
    setProjectId(activeProjectId && gitProjects.some((project) => project.id === activeProjectId) ? activeProjectId : gitProjects[0]?.id ?? '')
    setName('')
    setBranchName('')
  }, [activeProjectId, gitProjects, open])

  if (!open) return null

  const selectedProject = gitProjects.find((project) => project.id === projectId) ?? null
  const defaultBranch = name.trim() ? `workspace/${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'}` : 'workspace/<name>'

  return (
    <div className="code-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="code-project-dialog" role="dialog" aria-modal="true" aria-labelledby="code-create-workspace-title">
        <header className="code-project-dialog-header">
          <div><div className="code-dialog-icon"><BriefcaseBusiness size={17} aria-hidden="true" /></div><div><p className="code-dialog-eyebrow">New isolated workspace</p><h2 id="code-create-workspace-title">Add workspace</h2></div></div>
          <button type="button" className="code-dialog-close" onClick={onClose} aria-label="Close dialog"><X size={17} aria-hidden="true" /></button>
        </header>
        <p className="code-dialog-description">Create a Git worktree with its own branch and durable pane layout. The project folder remains unchanged.</p>
        <div className="code-dialog-form">
          <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={busy}>
            <option value="" disabled>Select a Git project</option>
            {gitProjects.map((project) => <option key={project.id} value={project.id}>{project.display_name}</option>)}
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
