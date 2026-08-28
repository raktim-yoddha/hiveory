import React, { useState, useEffect } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Columns2,
  FolderOpen,
  Grid2X2,
  LayoutTemplate,
  RefreshCw,
  Rows2,
  Sparkles,
  X,
} from 'lucide-react'
import type { CodePanePreset } from '../api/agentic-super-app-client'
import type { CodeWorkspaceController } from './state/use-code-workspace-controller'
import { CodePaneTree } from './CodePaneTree'
import { CodePaneLeaf } from './CodePaneLeaf'

interface CodePaneCanvasProps {
  controller: CodeWorkspaceController
  onOpenFolder: () => void
}

interface GridPresetOption {
  id: CodePanePreset
  title: string
  desc: string
  icon: React.ReactNode
}

const GRID_OPTIONS: GridPresetOption[] = [
  {
    id: 'main_left',
    title: 'Focus Grid',
    desc: 'Main pane on left, stacked on right',
    icon: <LayoutTemplate size={16} />,
  },
  {
    id: 'equal_columns',
    title: 'Dual Grid',
    desc: 'Equal side-by-side columns',
    icon: <Columns2 size={16} />,
  },
  {
    id: 'equal_rows',
    title: 'Stack Grid',
    desc: 'Equal stacked horizontal rows',
    icon: <Rows2 size={16} />,
  },
  {
    id: 'grid',
    title: 'Quad Grid',
    desc: 'Equal 2x2 quadrant layout',
    icon: <Grid2X2 size={16} />,
  },
  {
    id: 'tidy',
    title: 'Tidy',
    desc: 'Auto-balanced layout',
    icon: <Sparkles size={16} />,
  },
]

export const CodePaneCanvas: React.FC<CodePaneCanvasProps> = ({ controller, onOpenFolder }) => {
  const { state, confirmClose, dismissConfirmClose, dismissError, applyPreset } = controller
  const { layout, maximizedPaneId, error, confirmClosePane } = state
  const [isDragging, setIsDragging] = useState(false)
  const [activeDropPreset, setActiveDropPreset] = useState<CodePanePreset | null>(null)

  useEffect(() => {
    const handleDragStart = () => {
      setIsDragging(true)
      document.body.classList.add('is-dragging-pane')
    }
    const handleDragEnd = () => {
      setIsDragging(false)
      setActiveDropPreset(null)
      document.body.classList.remove('is-dragging-pane')
    }

    window.addEventListener('agentic-super-app-pane-drag-start', handleDragStart)
    window.addEventListener('agentic-super-app-pane-drag-end', handleDragEnd)
    window.addEventListener('dragend', handleDragEnd)
    window.addEventListener('mouseup', handleDragEnd)

    return () => {
      window.removeEventListener('agentic-super-app-pane-drag-start', handleDragStart)
      window.removeEventListener('agentic-super-app-pane-drag-end', handleDragEnd)
      window.removeEventListener('dragend', handleDragEnd)
      window.removeEventListener('mouseup', handleDragEnd)
    }
  }, [])

  if (!layout) {
    return (
      <main className="code-workspace-canvas code-workspace-empty" aria-label="Code workspace canvas">
        <div className="code-empty-workspace-card">
          <div className="code-empty-workspace-icon"><FolderOpen size={22} aria-hidden="true" /></div>
          <h2>Open a workspace</h2>
          <p>Select a folder to launch terminals, coding agents, previews, and threads in docked panes.</p>
          <button type="button" className="code-primary-button" onClick={onOpenFolder}><FolderOpen size={14} aria-hidden="true" />Open folder</button>
        </div>
      </main>
    )
  }

  const maximizedNode = maximizedPaneId ? layout.nodes.find((node) => node.pane_id === maximizedPaneId) : null

  return (
    <main className="code-workspace-canvas" aria-label="Code workspace canvas">
      {error && (
        <div className="code-workspace-error" role="alert">
          <span><AlertCircle size={14} aria-hidden="true" />{error}</span>
          <button type="button" onClick={dismissError} aria-label="Dismiss workspace error"><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      {/* Floating Top Drag Grid Layout Dropzone Bar */}
      {isDragging && (
        <div
          className="code-canvas-grid-bar"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
        >
          <div className="code-grid-bar-header">
            <span>Drop pane to change layout grid:</span>
          </div>
          <div className="code-grid-bar-options">
            {GRID_OPTIONS.map((opt) => {
              const isHovered = activeDropPreset === opt.id
              return (
                <div
                  key={opt.id}
                  className={`code-grid-drop-card ${isHovered ? 'is-active' : ''}`}
                  onDragEnter={() => setActiveDropPreset(opt.id)}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (activeDropPreset !== opt.id) setActiveDropPreset(opt.id)
                  }}
                  onDragLeave={() => {
                    if (activeDropPreset === opt.id) setActiveDropPreset(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                    setActiveDropPreset(null)
                    document.body.classList.remove('is-dragging-pane')
                    window.dispatchEvent(new Event('agentic-super-app-pane-drag-end'))
                    void applyPreset(opt.id)
                  }}
                  onClick={() => {
                    void applyPreset(opt.id)
                  }}
                >
                  <span className="code-grid-drop-icon">{opt.icon}</span>
                  <div className="code-grid-drop-text">
                    <span className="code-grid-drop-title">{opt.title}</span>
                    <span className="code-grid-drop-desc">{opt.desc}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="code-pane-canvas-body">
        {maximizedNode ? (
          <CodePaneLeaf node={maximizedNode} controller={controller} />
        ) : (
          <CodePaneTree nodeId={layout.root_id} layout={layout} controller={controller} />
        )}
      </div>

      {confirmClosePane && (
        <div className="code-modal-backdrop" role="presentation">
          <section className="code-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="code-confirm-close-title">
            <div className="code-confirm-heading"><AlertTriangle size={18} aria-hidden="true" /><h2 id="code-confirm-close-title">Close running pane?</h2></div>
            <p>The process in <strong>{confirmClosePane.title}</strong> is still active. Closing this pane will terminate it.</p>
            <div className="code-confirm-actions">
              <button type="button" className="code-secondary-button" onClick={dismissConfirmClose}>Cancel</button>
              <button type="button" className="code-danger-button" onClick={() => void confirmClose(true)}><RefreshCw size={13} aria-hidden="true" />Stop and close</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
