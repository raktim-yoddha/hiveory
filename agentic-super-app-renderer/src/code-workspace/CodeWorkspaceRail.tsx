import React from 'react'
import {
  ChevronDown,
  Globe,
  Plus,
  Moon,
  Settings,
} from 'lucide-react'
import type {
  CodePaneNode,
  CodeWorkspaceSummary,
} from '../api/agentic-super-app-client'
import type { CodeWorkspaceController } from './state/use-code-workspace-controller'
import { CliBrandIcon } from './CliIcons'

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

function renderPaneRailIcon(node: CodePaneNode) {
  switch (node.kind) {
    case 'coding_agent':
      return <CliBrandIcon identifier={node.title} size={13} />
    case 'preview':
      return <Globe size={13} style={{ color: '#60a5fa' }} />
    case 'thread':
      return <span style={{ color: '#9ca3af', fontSize: 13 }}>⚙</span>
    case 'terminal':
      return <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600 }}>🔲</span>
    default:
      return <span style={{ color: '#9ca3af', fontSize: 13 }}>✳</span>
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

      {/* Workspaces & Docked Panes Tree (Stable Order Preserved) */}
      <div className="code-rail-workspaces-list">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId
          const isWorkspaceView = activeGlobalSection === 'workspace'

          if (isActive) {
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
                  <ChevronDown size={13} style={{ color: '#8a8f98' }} />
                  <span>{workspace.display_name}</span>
                </button>

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
                        {renderPaneRailIcon(leaf)}
                        <span>{leaf.title || (leaf.kind === 'empty' ? 'New pane' : leaf.kind)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          }

          return (
            <button
              key={workspace.id}
              type="button"
              className="code-rail-inactive-ws"
              onClick={() => {
                onSelectWorkspace(workspace.id)
                onSelectGlobalSection?.('workspace')
              }}
            >
              {workspace.display_name}
            </button>
          )
        })}
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
