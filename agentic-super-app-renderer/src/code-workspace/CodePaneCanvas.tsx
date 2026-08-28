import React from 'react'
import { AlertCircle, AlertTriangle, FolderOpen, RefreshCw, X } from 'lucide-react'
import type { CodeWorkspaceController } from './state/use-code-workspace-controller'
import { CodePaneTree } from './CodePaneTree'
import { CodePaneLeaf } from './CodePaneLeaf'

interface CodePaneCanvasProps {
  controller: CodeWorkspaceController
  onOpenFolder: () => void
}

export const CodePaneCanvas: React.FC<CodePaneCanvasProps> = ({ controller, onOpenFolder }) => {
  const { state, confirmClose, dismissConfirmClose, dismissError } = controller
  const { layout, maximizedPaneId, error, confirmClosePane } = state

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

      <div className="code-pane-canvas-body">
        {maximizedNode ? <CodePaneLeaf node={maximizedNode} controller={controller} /> : <CodePaneTree nodeId={layout.root_id} layout={layout} controller={controller} />}
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
