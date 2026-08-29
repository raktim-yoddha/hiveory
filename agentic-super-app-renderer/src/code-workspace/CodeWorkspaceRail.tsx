import React, { useMemo, useState } from 'react'
import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Folder,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  Moon,
  Plus,
  Puzzle,
  Settings,
  Settings2,
  Sparkles,
  SquareTerminal,
} from 'lucide-react'
import type {
  CodePaneNode,
  CodeProjectSummary,
  CodeWorkspaceSummary,
} from '../api/agentic-super-app-client'
import type { CodeWorkspaceController } from './state/use-code-workspace-controller'
import { CliBrandIcon } from './CliIcons'

interface CodeWorkspaceRailProps {
  controller: CodeWorkspaceController
  projects: CodeProjectSummary[]
  workspaces: CodeWorkspaceSummary[]
  activeWorkspaceId: string | null
  activeGlobalSection: 'dashboard' | 'routines' | 'plugins' | 'skills' | 'workspace'
  onSelectWorkspace: (workspaceId: string) => void
  onAddProject: () => void
  onAddWorkspace: (projectId?: string) => void
  onSelectGlobalSection?: (section: 'dashboard' | 'routines' | 'plugins' | 'skills' | 'workspace') => void
}

function renderPaneRailIcon(node: CodePaneNode) {
  switch (node.kind) {
    case 'coding_agent':
      return <CliBrandIcon identifier={node.title} size={13} />
    case 'preview':
      return <FolderOpen size={13} style={{ color: '#60a5fa' }} aria-hidden="true" />
    case 'thread':
      return <Settings2 size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
    case 'terminal':
      return <SquareTerminal size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
    default:
      return <Sparkles size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
  }
}

export const CodeWorkspaceRail: React.FC<CodeWorkspaceRailProps> = ({
  controller,
  projects,
  workspaces,
  activeWorkspaceId,
  activeGlobalSection,
  onSelectWorkspace,
  onAddProject,
  onAddWorkspace,
  onSelectGlobalSection,
}) => {
  const { state, focusPane } = controller
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const leaves = state.layout?.nodes.filter((node) => node.children.length === 0) ?? []
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const projectRows = useMemo(() => {
    if (projects.length > 0) return projects
    const fallback = new Map<string, CodeProjectSummary>()
    for (const workspace of workspaces) {
      if (fallback.has(workspace.project_id)) continue
      fallback.set(workspace.project_id, {
        id: workspace.project_id,
        host_id: workspace.host_id,
        display_name: workspace.repository_name ?? workspace.display_name,
        root_path: workspace.root_path,
        repository_name: workspace.repository_name,
        kind: workspace.is_git_repository ? 'git' : 'folder',
        primary_workspace_id: workspace.id,
        current_branch: workspace.branch,
        workspace_count: 1,
        available: workspace.available,
        unavailable_reason: workspace.unavailable_reason,
        updated_at_unix_ms: workspace.updated_at_unix_ms,
      })
    }
    return [...fallback.values()]
  }, [projects, workspaces])

  const navItems: { id: 'dashboard' | 'routines' | 'plugins' | 'skills'; label: string; badge?: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', badge: '1', icon: <LayoutDashboard size={15} aria-hidden="true" /> },
    { id: 'routines', label: 'Routines', icon: <Clock3 size={15} aria-hidden="true" /> },
    { id: 'plugins', label: 'Plugins', icon: <Puzzle size={15} aria-hidden="true" /> },
    { id: 'skills', label: 'Skills', icon: <Sparkles size={15} aria-hidden="true" /> },
  ]

  const toggleProject = (projectId: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const renderPaneTree = (workspaceId: string) => {
    if (workspaceId !== activeWorkspaceId || activeGlobalSection !== 'workspace') return null

    return (
      <div className="code-rail-pane-tree">
        {leaves.map((leaf) => {
          const isFocused = leaf.pane_id === state.focusedPaneId
          return (
            <button
              type="button"
              key={leaf.pane_id}
              className={`code-rail-pane-row ${isFocused ? 'is-focused' : ''}`}
              onClick={() => {
                onSelectGlobalSection?.('workspace')
                void focusPane(leaf.pane_id)
              }}
            >
              {renderPaneRailIcon(leaf)}
              <span>{leaf.title || (leaf.kind === 'empty' ? 'New pane' : leaf.kind.replace('_', ' '))}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <aside className="code-workspace-rail" aria-label="Code workspace">
      <nav className="code-rail-global-nav" aria-label="Application sections">
        {navItems.map(({ id, label, badge, icon }) => (
          <button
            type="button"
            key={id}
            className={`code-rail-nav-item ${activeGlobalSection === id ? 'is-selected' : ''}`}
            onClick={() => onSelectGlobalSection?.(id)}
          >
            <span className="code-rail-nav-left">{icon}<span>{label}</span></span>
            {badge && <span className="code-rail-badge-count">{badge}</span>}
          </button>
        ))}
      </nav>

      <div className="code-rail-section-header">
        <span>Workspaces</span>
        <div className="code-rail-add-wrapper">
          <button
            type="button"
            className="code-rail-add-btn"
            onClick={() => setIsAddMenuOpen((current) => !current)}
            aria-label="Add project or workspace"
            aria-expanded={isAddMenuOpen}
            title="Add project or workspace"
          >
            <Plus size={15} aria-hidden="true" />
          </button>
          {isAddMenuOpen && (
            <div className="code-rail-add-menu" role="menu" aria-label="Add to workspace rail">
              <button type="button" role="menuitem" onClick={() => { setIsAddMenuOpen(false); onAddProject() }}>
                <FolderOpen size={14} aria-hidden="true" />
                <span><strong>Add Project</strong><small>Register a folder and its primary workspace</small></span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!projectRows.some((project) => project.kind === 'git' && project.available)}
                onClick={() => { setIsAddMenuOpen(false); onAddWorkspace() }}
              >
                <BriefcaseBusiness size={14} aria-hidden="true" />
                <span><strong>Add Workspace</strong><small>Create an isolated Git workspace</small></span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="code-rail-workspaces-list">
        {projectRows.length === 0 && (
          <div className="code-rail-empty-projects">
            <Folder size={15} aria-hidden="true" />
            <span>No projects yet</span>
            <button type="button" onClick={onAddProject}>Add project</button>
          </div>
        )}
        {projectRows.map((project) => {
          const projectWorkspaces = workspaces.filter((workspace) => workspace.project_id === project.id)
          const isCollapsed = collapsedProjects.has(project.id)
          const projectIsActive = activeWorkspace?.project_id === project.id
          const primaryWorkspace = workspaces.find((workspace) => workspace.id === project.primary_workspace_id) ?? projectWorkspaces[0]
          const showWorkspaceRows = projectWorkspaces.length > 1
          return (
            <section key={project.id} className={`code-rail-project-group ${projectIsActive ? 'is-active-project' : ''}`}>
              <div className="code-rail-project-row">
                <button
                  type="button"
                  className="code-rail-project-disclosure"
                  onClick={() => toggleProject(project.id)}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.display_name}`}
                  aria-expanded={!isCollapsed}
                  title={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.display_name}`}
                >
                  {isCollapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="code-rail-project-select"
                  onClick={() => {
                    if (primaryWorkspace?.available) {
                      onSelectWorkspace(primaryWorkspace.id)
                      onSelectGlobalSection?.('workspace')
                    }
                  }}
                  title={project.available ? project.root_path : project.unavailable_reason ?? project.root_path}
                  disabled={!primaryWorkspace?.available}
                >
                  <Folder size={14} aria-hidden="true" />
                  <span className="code-rail-project-name">{project.display_name}</span>
                  <span className={`code-live-dot ${project.available ? '' : 'is-offline'}`} aria-label={project.available ? 'Available' : 'Unavailable'} />
                </button>
                <div className="code-rail-project-actions">
                  <button
                    type="button"
                    onClick={() => onAddWorkspace(project.id)}
                    disabled={project.kind !== 'git' || !project.available}
                    aria-label={`Add workspace to ${project.display_name}`}
                    title={project.kind === 'git' ? 'Add workspace' : 'Folder projects have one workspace'}
                  >
                    <Plus size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {!isCollapsed && (
                <div className="code-rail-project-children">
                  {showWorkspaceRows ? projectWorkspaces.map((workspace) => {
                    const isActive = workspace.id === activeWorkspaceId
                    return (
                      <div key={workspace.id} className="code-rail-workspace-group">
                        <button
                          type="button"
                          className={`code-rail-workspace-row ${isActive && activeGlobalSection === 'workspace' ? 'is-active' : ''}`}
                          onClick={() => {
                            if (!workspace.available) return
                            onSelectWorkspace(workspace.id)
                            onSelectGlobalSection?.('workspace')
                          }}
                          title={workspace.available ? workspace.root_path : workspace.unavailable_reason ?? workspace.root_path}
                          disabled={!workspace.available}
                        >
                          <span className="code-rail-workspace-kind-icon">
                            {workspace.workspace_kind === 'managed_worktree' ? <GitBranch size={13} aria-hidden="true" /> : <Folder size={13} aria-hidden="true" />}
                          </span>
                          <span className="code-rail-workspace-name">{workspace.display_name}</span>
                          {!workspace.available && <CircleAlert size={12} className="code-rail-warning-icon" aria-label="Workspace unavailable" />}
                          {workspace.workspace_kind === 'managed_worktree' && <span className="code-rail-kind-label">isolated</span>}
                        </button>
                        {renderPaneTree(workspace.id)}
                      </div>
                    )
                  }) : primaryWorkspace && renderPaneTree(primaryWorkspace.id)}
                </div>
              )}
            </section>
          )
        })}
      </div>

      <footer className="code-rail-footer">
        <div className="code-rail-footer-metric"><span>Notch</span><span className="code-rail-toggle-pill">Off</span></div>
        <div className="code-rail-footer-metric"><span>Credits</span><span className="code-rail-credits-value">9,684</span></div>
        <div className="code-rail-user-card">
          <div className="code-rail-user-left">
            <div className="code-rail-avatar">A</div>
            <div className="code-rail-user-info"><span className="code-rail-username">Developer</span><span className="code-rail-user-badge">PRO</span></div>
          </div>
          <div className="code-rail-user-actions">
            <button type="button" className="code-rail-user-icon-btn" title="Theme"><Moon size={14} aria-hidden="true" /></button>
            <button type="button" className="code-rail-user-icon-btn" title="Settings"><Settings size={14} aria-hidden="true" /></button>
          </div>
        </div>
      </footer>
    </aside>
  )
}
