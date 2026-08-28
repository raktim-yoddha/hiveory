import React from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { CodePanePlacement } from '../api/agentic-super-app-client'

const paneDropTargetId = (paneId: string, placement: CodePanePlacement) =>
  `pane-drop:${paneId}:${placement}`

interface PaneDropTargetProps {
  paneId: string
  placement: CodePanePlacement
  active: boolean
}

const PaneDropTarget: React.FC<PaneDropTargetProps> = ({ paneId, placement, active }) => {
  const { isOver, setNodeRef } = useDroppable({
    id: paneDropTargetId(paneId, placement),
    data: { type: 'pane', paneId, placement },
    disabled: !active,
  })

  return (
    <div
      ref={setNodeRef}
      className={`code-pane-drop-zone placement-${placement} ${active ? 'is-active' : ''} ${isOver ? 'is-over' : ''}`}
      aria-hidden={!active}
    />
  )
}

interface CodePaneDropTargetsProps {
  paneId: string
  active: boolean
}

export const CodePaneDropTargets: React.FC<CodePaneDropTargetsProps> = ({ paneId, active }) => (
  <div className={`code-pane-drop-zones ${active ? 'is-active' : ''}`} aria-hidden={!active}>
    <PaneDropTarget paneId={paneId} placement="center" active={active} />
    <PaneDropTarget paneId={paneId} placement="left" active={active} />
    <PaneDropTarget paneId={paneId} placement="right" active={active} />
    <PaneDropTarget paneId={paneId} placement="top" active={active} />
    <PaneDropTarget paneId={paneId} placement="bottom" active={active} />
  </div>
)

interface GridPresetDropTargetProps {
  preset: string
  active: boolean
}

export const GridPresetDropTarget: React.FC<GridPresetDropTargetProps> = ({ preset, active }) => {
  const { isOver, setNodeRef } = useDroppable({
    id: `preset:${preset}`,
    data: { type: 'preset', preset },
    disabled: !active,
  })

  return <span ref={setNodeRef} className={`code-grid-drop-target ${isOver ? 'is-over' : ''}`} aria-hidden="true" />
}
