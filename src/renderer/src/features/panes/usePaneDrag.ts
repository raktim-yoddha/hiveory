import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { LayoutOperation } from '@shared/domain'
import { resolveDropTarget, type DropTarget } from '@shared/layout/drop'
import type { Rect } from '@shared/layout/geometry'

/** Pointer travel before a press on a pane header becomes a drag. */
const DRAG_THRESHOLD = 4

export interface DragState {
  paneId: string
  swap: boolean
  target: DropTarget | null
}

interface Options {
  containerRef: RefObject<HTMLElement | null>
  panes: Record<string, Rect>
  onOperation: (op: LayoutOperation) => void
}

const toOperation = (paneId: string, target: DropTarget): LayoutOperation =>
  target.kind === 'swap'
    ? { type: 'swap', paneId, targetPaneId: target.targetPaneId }
    : target.kind === 'move'
      ? { type: 'move', paneId, targetPaneId: target.targetPaneId, side: target.side }
      : { type: 'dock', paneId, side: target.side }

/**
 * Pane drag-and-drop: drag toward an edge for a docking preview; hold Space
 * while dragging and release over another pane to swap (design.md).
 */
export const usePaneDrag = ({ containerRef, panes, onOperation }: Options) => {
  const [drag, setDragState] = useState<DragState | null>(null)
  /** Source of truth for event handlers; React state only drives rendering, so a fast release never races a render. */
  const dragRef = useRef<DragState | null>(null)
  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next
    setDragState(next)
  }, [])
  const pending = useRef<{ paneId: string; x: number; y: number } | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const swapHeld = useRef(false)
  const live = useRef({ panes, onOperation })
  useLayoutEffect(() => {
    live.current = { panes, onOperation }
  })

  const resolve = useCallback(
    (paneId: string): DragState => {
      const box = containerRef.current?.getBoundingClientRect()
      if (!box) return { paneId, swap: swapHeld.current, target: null }
      const target = resolveDropTarget({
        x: pointer.current.x - box.left,
        y: pointer.current.y - box.top,
        panes: live.current.panes,
        container: { x: 0, y: 0, width: box.width, height: box.height },
        draggedPaneId: paneId,
        swap: swapHeld.current
      })
      return { paneId, swap: swapHeld.current, target }
    },
    [containerRef]
  )

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      pointer.current = { x: event.clientX, y: event.clientY }
      const start = pending.current
      if (!dragRef.current && start) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return
        // Keep keystrokes (notably Space) from reaching a focused terminal mid-drag.
        ;(document.activeElement as HTMLElement | null)?.blur()
        pending.current = null
        setDrag(resolve(start.paneId))
        return
      }
      if (dragRef.current) setDrag(resolve(dragRef.current.paneId))
    }
    const onUp = (): void => {
      pending.current = null
      const current = dragRef.current
      if (!current) return
      const final = resolve(current.paneId)
      if (final.target) live.current.onOperation(toOperation(current.paneId, final.target))
      swapHeld.current = false
      setDrag(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (!dragRef.current) return
      if (event.key === 'Escape' && event.type === 'keydown') {
        swapHeld.current = false
        setDrag(null)
      } else if (event.key === ' ') {
        swapHeld.current = event.type === 'keydown'
        setDrag(resolve(dragRef.current.paneId))
      } else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  }, [resolve, setDrag])

  /** Attach to a pane's drag handle (its header). Presses on buttons inside are ignored. */
  const startDrag = useCallback((paneId: string, event: ReactPointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, [role="menu"]')) return
    pending.current = { paneId, x: event.clientX, y: event.clientY }
    pointer.current = { x: event.clientX, y: event.clientY }
  }, [])

  return { drag, startDrag }
}
