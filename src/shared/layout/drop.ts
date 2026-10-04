import type { Side } from '../domain/layout'
import { containsPoint, sliceRect, type Rect } from './geometry'

export type DropTarget =
  | { kind: 'swap'; targetPaneId: string; preview: Rect }
  | { kind: 'move'; targetPaneId: string; side: Side; preview: Rect }
  | { kind: 'dock'; side: Side; preview: Rect }

export interface DropQuery {
  x: number
  y: number
  panes: Record<string, Rect>
  container: Rect
  draggedPaneId: string
  /** Space is held: releasing over another pane swaps the two. */
  swap: boolean
  /** Distance from the container edge that docks along the whole layout edge. */
  edgeThreshold?: number
}

const closest = (entries: Array<[Side, number]>): [Side, number] =>
  entries.reduce((best, d) => (d[1] < best[1] ? d : best))

/** Resolves where a dragged pane would land. Pure so drag behavior is testable. */
export const resolveDropTarget = (q: DropQuery): DropTarget | null => {
  const others = Object.keys(q.panes).filter((id) => id !== q.draggedPaneId)
  if (others.length === 0) return null

  const c = q.container
  if (!q.swap && containsPoint(c, q.x, q.y)) {
    const [side, distance] = closest([
      ['left', q.x - c.x],
      ['right', c.x + c.width - q.x],
      ['top', q.y - c.y],
      ['bottom', c.y + c.height - q.y]
    ])
    if (distance <= (q.edgeThreshold ?? 28)) return { kind: 'dock', side, preview: sliceRect(c, side, 1 / 3) }
  }

  const targetPaneId = others.find((id) => containsPoint(q.panes[id] as Rect, q.x, q.y))
  if (!targetPaneId) return null
  const rect = q.panes[targetPaneId] as Rect
  if (q.swap) return { kind: 'swap', targetPaneId, preview: rect }
  const [side] = closest([
    ['left', (q.x - rect.x) / rect.width],
    ['right', (rect.x + rect.width - q.x) / rect.width],
    ['top', (q.y - rect.y) / rect.height],
    ['bottom', (rect.y + rect.height - q.y) / rect.height]
  ])
  return { kind: 'move', targetPaneId, side, preview: sliceRect(rect, side) }
}
