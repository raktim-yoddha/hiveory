import React from 'react'
import {
  ChevronDown,
  ChevronRight,
  Globe,
  MessageSquare,
  Plus,
  Terminal,
  Sparkles,
  Moon,
  Settings,
} from 'lucide-react'
import type {
  CodePaneKind,
  CodeWorkspaceSummary,
} from '../api/agentic-super-app-client'
import type { CodeWorkspaceController } from './state/use-code-workspace-controller'

interface CodeWorkspaceRailProps {
  controller: CodeWorkspaceController
  workspaces: CodeWorkspaceSummary[]
  activeWorkspaceId: string | null
  activeGlobalSection: 'dashboard' | 'routines' | 'plugins' | 'skills' | 'workspace'
  onSelectWorkspace: (workspaceId: string) => void
  onOpenFolder: () => void
  onSelectGlobalSection?: (section: 'dashboard' | 'routines' | 'plugins' | 'skills' | 'workspace') => void
  onTrustWorkspace?: () => void
}

function resourceIcon(kind: CodePaneKind) {
  switch (kind) {
    case 'coding_agent':
      return <span style={{ color: '#f59e0b', fontSize: 13, fontWeight: 700 }}>✳</span>
    case 'preview':
      return <Globe size={13} style={{ color: '#60a5fa' }} />
    case 'thread':
      return <MessageSquare size={13} style={{ color: '#9ca3af' }} />
    case 'terminal':
      return <Terminal size={13} style={{ color: '#9ca3af' }} />
    default:
      return <Sparkles size={13} />
  }
}

export const CodeWorkspaceRail: React.FC<CodeWorkspaceRailProps> = ({
  controller,
  workspaces,
  activeWorkspaceId,
  activeGlobalSection,
  onSelectWorkspace,
  onOpenFolder,
  onSelectGlobalSection,
}) => {
  const { state, focusPane } = controller
  const leaves = state.layout?.nodes.filter((node) => node.children.length === 0) ?? []

  const navItems: { id: 'dashboard' | 'routines' | 'plugins' | 'skills'; label: string; badge?: string }[] = [
    { id: 'dashboard', label: 'Dashboard', badge: '1' },
    { id: 'routines', label: 'Routines' },
    { id: 'plugins', label: 'Plugins' },
    { id: 'skills', label: 'Skills' },
  ]

  const inactiveList = ['agentic-super-app-api', 'bridgespace-desktop', 'agentic-super-app-ui', 'database']

  return (
    <aside className="code-workspace-rail" aria-label="Code workspace">
      {/* Top Nav Items */}
      <nav className="code-rail-global-nav" aria-label="Application sections">
        {navItems.map(({ id, label, badge }) => (
          <button
            type="button"
            key={id}
            className={`code-rail-nav-item ${activeGlobalSection === id ? 'is-selected' : ''}`}
            onClick={() => onSelectGlobalSection?.(id)}
          >
            <div className="code-rail-nav-left">
              <span>{label}</span>
            </div>
            {badge && <span className="code-rail-badge-count">{badge}</span>}
          </button>
        ))}
      </nav>

      {/* Workspaces Section */}
      <div className="code-rail-section-header">
        <span>Workspaces</span>
        <button
          type="button"
          className="code-rail-add-btn"
          onClick={onOpenFolder}
          aria-label="Open workspace folder"
          title="Open workspace folder"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Workspaces & Docked Panes Tree */}
      <div className="code-rail-workspaces-list">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId
          const isWorkspaceView = activeGlobalSection === 'workspace' && isActive

          return (
            <div key={workspace.id} className="code-rail-workspace-group">
              <button
                type="button"
                className={`code-rail-workspace-row ${isWorkspaceView ? 'is-active' : ''}`}
                onClick={() => {
                  onSelectWorkspace(workspace.id)
                  onSelectGlobalSection?.('workspace')
                }}
              >
                {isActive ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>{workspace.display_name}</span>
              </button>

              {isActive && (
                <div className="code-rail-pane-tree">
                  {leaves.map((leaf) => {
                    const isFocused = isWorkspaceView && leaf.pane_id === state.focusedPaneId
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
                        {resourceIcon(leaf.kind)}
                        <span>{leaf.title || (leaf.kind === 'empty' ? 'New pane' : leaf.kind)}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Inactive workspaces in list */}
        {inactiveList.map((name) => (
          <button
            key={name}
            type="button"
            className="code-rail-inactive-ws"
            onClick={onOpenFolder}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Bottom Sidebar Footer */}
      <footer className="code-rail-footer">
        <div className="code-rail-footer-metric">
          <span>Notch</span>
          <span className="code-rail-toggle-pill">Off</span>
        </div>

        <div className="code-rail-footer-metric">
          <span>Credits</span>
          <span className="code-rail-credits-value">9,684</span>
        </div>

        <div className="code-rail-user-card">
          <div className="code-rail-user-left">
            <div className="code-rail-avatar">A</div>
            <div className="code-rail-user-info">
              <span className="code-rail-username">Developer</span>
              <span className="code-rail-user-badge">PRO</span>
            </div>
          </div>
          <div className="code-rail-user-actions">
            <button type="button" className="code-rail-user-icon-btn" title="Theme">
              <Moon size={14} />
            </button>
            <button type="button" className="code-rail-user-icon-btn" title="Settings">
              <Settings size={14} />
            </button>
          </div>
        </div>
      </footer>
    </aside>
  )
}
