import React, { useMemo, useState } from 'react'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core'
import {
  AlertCircle,
  AlertTriangle,
  FolderOpen,
  RefreshCw,
  X,
} from 'lucide-react'
import type { CodePanePlacement, CodePanePreset } from '../../shared/api/hiveory-client'
import type { CodeWorkspaceController } from './state/use-code-workspace-controller'
import { CodePaneTree } from './CodePaneTree'
import { CodePaneLeaf } from './CodePaneLeaf'
import {
  PRIMARY_PRESETS,
  type CodePanePresetMeta,
} from './code-layout-presets-meta'

interface CodePaneCanvasProps {
  controller: CodeWorkspaceController
  onOpenFolder: () => void
}

function getActivatorPoint(event: Event): { x: number; y: number } | null {
  const pointerEvent = event as Partial<PointerEvent> & {
    changedTouches?: { 0?: { clientX: number; clientY: number } }
  }
  if (typeof pointerEvent.clientX === 'number' && typeof pointerEvent.clientY === 'number') {
    return { x: pointerEvent.clientX, y: pointerEvent.clientY }
  }
  const touch = pointerEvent.changedTouches?.[0]
  return touch ? { x: touch.clientX, y: touch.clientY } : null
}

// The drag preview must describe the pane without inheriting the source
// header's width. The source header stretches across its pane, but the
// floating preview is intentionally compact so it cannot cover drop targets.
const DRAG_PREVIEW_WIDTH = 196
const DRAG_PREVIEW_HEIGHT = 38

/** Keep the visual drag preview centered on the pointer that started the drag. */
const snapDragOverlayToPointer: Modifier = ({
  activatorEvent,
  activeNodeRect,
  transform,
}) => {
  if (!activatorEvent || !activeNodeRect) return transform
  const point = getActivatorPoint(activatorEvent)
  if (!point) return transform

  return {
    ...transform,
    x: transform.x + point.x - activeNodeRect.left - DRAG_PREVIEW_WIDTH / 2,
    y: transform.y + point.y - activeNodeRect.top - DRAG_PREVIEW_HEIGHT / 2,
  }
}

const renderPresetThumbnail = (type: CodePanePresetMeta['thumbnailType']) => {
  switch (type) {
    case 'vertical':
      return (
        <div className="code-layout-thumb-window thumb-vertical" aria-hidden="true">
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
        </div>
      )
    case 'horizontal':
      return (
        <div className="code-layout-thumb-window thumb-horizontal" aria-hidden="true">
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
        </div>
      )
    case 'equal':
    case 'two_rows':
      return (
        <div className="code-layout-thumb-window thumb-equal" aria-hidden="true">
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
        </div>
      )
    case 'three_rows':
      return (
        <div className="code-layout-thumb-window thumb-three-rows" aria-hidden="true">
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
        </div>
      )
    case 'four_rows':
      return (
        <div className="code-layout-thumb-window thumb-four-rows" aria-hidden="true">
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
          <div className="thumb-cell" />
        </div>
      )
    case 'focus':
      return (
        <div className="code-layout-thumb-window thumb-focus" aria-hidden="true">
          <div className="thumb-cell thumb-focus-main" />
          <div className="thumb-focus-stack">
            <div className="thumb-cell" />
            <div className="thumb-cell" />
          </div>
        </div>
      )
  }
}

interface GridPresetCardProps {
  preset: CodePanePresetMeta
  paneCount: number
  active: boolean
  onSelect: (preset: CodePanePreset) => void
}

const GridPresetCard: React.FC<GridPresetCardProps> = ({
  preset,
  paneCount,
  active,
  onSelect,
}) => {
  const disabled = paneCount > preset.maxPanes
  const { isOver, setNodeRef } = useDroppable({
    id: `preset:${preset.id}`,
    data: { type: 'preset', preset: preset.id },
    disabled: !active || disabled,
  })

  const tooltipText = disabled
    ? `${preset.label}: Supports up to ${preset.maxPanes} panes (current: ${paneCount})`
    : `${preset.label} — ${preset.description}`

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`code-layout-card ${disabled ? 'is-disabled' : ''} ${isOver ? 'is-over' : ''}`}
      onClick={() => {
        if (!disabled) onSelect(preset.id)
      }}
      disabled={disabled}
      aria-disabled={disabled}
      title={tooltipText}
      data-preset={preset.id}
    >
      <div className="code-layout-thumb-container">
        {renderPresetThumbnail(preset.thumbnailType)}
      </div>
      <span className="code-layout-card-label">{preset.label}</span>
    </button>
  )
}

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

  const currentPaneCount = useMemo(() => {
    if (!layout) return 0
    return layout.nodes.filter((n) => n.children.length === 0).length
  }, [layout])

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
          <p>Select a folder to launch terminals, coding agents, a browser, and Markdown documents in docked panes.</p>
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
            {PRIMARY_PRESETS.map((preset) => (
              <GridPresetCard
                key={preset.id}
                preset={preset}
                paneCount={currentPaneCount}
                active={Boolean(activePaneId)}
                onSelect={(presetId) => void applyPreset(presetId)}
              />
            ))}
          </div>
        )}

        <div className="code-pane-canvas-body">
          {maximizedNode ? (
            <CodePaneLeaf
              node={maximizedNode}
              controller={controller}
              isDragActive={Boolean(activePaneId)}
              draggedPaneId={activePaneId}
            />
          ) : (
            <CodePaneTree
              nodeId={layout.root_id}
              layout={layout}
              controller={controller}
              isDragActive={Boolean(activePaneId)}
              draggedPaneId={activePaneId}
            />
          )}
        </div>

        <DragOverlay
          modifiers={[snapDragOverlayToPointer]}
          adjustScale={false}
          dropAnimation={null}
          style={{ width: DRAG_PREVIEW_WIDTH, height: DRAG_PREVIEW_HEIGHT }}
        >
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
