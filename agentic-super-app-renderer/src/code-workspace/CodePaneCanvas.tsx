import React, { useMemo, useState } from 'react'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
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
import type { CodePanePlacement, CodePanePreset } from '../api/agentic-super-app-client'
import type { CodeWorkspaceController } from './state/use-code-workspace-controller'
import { CodePaneTree } from './CodePaneTree'
import { CodePaneLeaf } from './CodePaneLeaf'
import { GridPresetDropTarget } from './CodePaneDropTargets'

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
  const [activePaneId, setActivePaneId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const activePane = useMemo(
    () => layout?.nodes.find((node) => node.pane_id === activePaneId),
    [activePaneId, layout?.nodes],
  )

  const handleDragStart = ({ active }: DragStartEvent) => {
    const paneId = active.data.current?.paneId
    setActivePaneId(typeof paneId === 'string' ? paneId : null)
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActivePaneId(null)
    if (!over) return

    const sourcePaneId = active.data.current?.paneId
    const target = over.data.current as {
      type?: string
      paneId?: string
      placement?: CodePanePlacement
      preset?: CodePanePreset
    } | undefined
    if (typeof sourcePaneId !== 'string' || !target?.type) return

    if (target.type === 'preset' && target.preset) {
      void applyPreset(target.preset, sourcePaneId)
      return
    }

    if (
      target.type === 'pane' &&
      typeof target.paneId === 'string' &&
      target.paneId !== sourcePaneId &&
      target.placement
    ) {
      void controller.movePane(sourcePaneId, target.paneId, target.placement)
    }
  }

  const handleDragCancel = () => setActivePaneId(null)

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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        {/* Floating Top Drag Grid Layout Dropzone Bar */}
        {activePaneId && (
          <div className="code-canvas-grid-bar" role="region" aria-label="Layout presets">
          <div className="code-grid-bar-header">
            <span>Drop pane to change layout grid:</span>
          </div>
          <div className="code-grid-bar-options">
            {GRID_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.id}
                className="code-grid-drop-card"
                onClick={() => void applyPreset(opt.id)}
              >
                <GridPresetDropTarget preset={opt.id} active={Boolean(activePaneId)} />
                <span className="code-grid-drop-icon">{opt.icon}</span>
                <div className="code-grid-drop-text">
                  <span className="code-grid-drop-title">{opt.title}</span>
                  <span className="code-grid-drop-desc">{opt.desc}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
        )}

        <div className="code-pane-canvas-body">
          {maximizedNode ? (
            <CodePaneLeaf node={maximizedNode} controller={controller} isDragActive={Boolean(activePaneId)} />
          ) : (
            <CodePaneTree nodeId={layout.root_id} layout={layout} controller={controller} isDragActive={Boolean(activePaneId)} />
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activePane ? (
            <div className="code-pane-drag-overlay">
              <span className="code-live-dot" />
              <span>{activePane.title || 'Empty'}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
