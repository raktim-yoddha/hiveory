import type { ArrangeMode, Side } from '../domain/layout'
import { containsPoint, sliceRect, type Rect } from './geometry'
import { ARRANGE_MODES } from './presets'

export type DropTarget =
  | { kind: 'arrange'; mode: ArrangeMode; preview: Rect }
  | { kind: 'swap'; targetPaneId: string; preview: Rect }
  | { kind: 'move'; targetPaneId: string; side: Side; preview: Rect }
  | { kind: 'dock'; side: Side; preview: Rect }
  /** Tabbed panes (ADR 0042): into an area as a tab, before `beforePaneId` (else last). `insert`: the preview is a bar between tabs. */
  | { kind: 'stack'; targetPaneId: string; beforePaneId?: string; insert?: boolean; preview: Rect }

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
  /** Tabbed panes: the middle of another area adds the pane there as a tab. */
  stacking?: boolean
  /** Tabbed panes: each pane's area. Only an area's shown tab is a target (another of its tabs while that one is dragged). */
  areas?: Record<string, { paneIds: string[]; active: string }>
}

/** The pane that stands for each area while `dragged` moves: its shown tab, or another tab when that one is dragged. */
const standIns = (panes: Record<string, Rect>, dragged: string, areas?: DropQuery['areas']): string[] =>
  Object.keys(panes).filter((id) => {
    if (id === dragged) return false
    const area = areas?.[id]
    if (!area) return true
    const shown = area.active === dragged ? area.paneIds.find((p) => p !== dragged) : area.active
    return id === shown
  })

/** The middle of an area, as a share of each side, that means "add as a tab". */
const STACK_ZONE = 0.3

/** Height of the band along the top edge that reveals the arrange bar. */
export const ARRANGE_BAND = 64
const OPTION = { width: 120, height: 44, gap: 8, top: 10 }

/** Where each arrange option is drawn; shared by hit-testing and rendering. */
export const arrangeBarRects = (container: Rect): Array<{ mode: ArrangeMode; label: string; rect: Rect }> => {
  const total = ARRANGE_MODES.length * OPTION.width + (ARRANGE_MODES.length - 1) * OPTION.gap
  const left = container.x + (container.width - total) / 2
  return ARRANGE_MODES.map(({ mode, label }, i) => ({
    mode,
    label,
    rect: { x: left + i * (OPTION.width + OPTION.gap), y: container.y + OPTION.top, width: OPTION.width, height: OPTION.height }
  }))
}

/** True while the pointer is in the top band (the arrange bar should be visible). Never more than a quarter of the area. */
export const inArrangeBand = (container: Rect, y: number, x: number): boolean =>
  containsPoint(container, x, y) && y - container.y <= Math.min(ARRANGE_BAND, container.height / 4)

const closest = (entries: Array<[Side, number]>): [Side, number] =>
  entries.reduce((best, d) => (d[1] < best[1] ? d : best))

/** Resolves where a dragged pane would land. Pure so drag behavior is testable. */
export const resolveDropTarget = (q: DropQuery): DropTarget | null => {
  const others = standIns(q.panes, q.draggedPaneId, q.areas)
  if (others.length === 0) return null

  const c = q.container
  if (!q.swap && inArrangeBand(c, q.y, q.x)) {
    // The top edge is reserved for whole-layout arrangements; the option under the pointer wins.
    const option = arrangeBarRects(c).find((o) => q.x >= o.rect.x - OPTION.gap / 2 && q.x <= o.rect.x + o.rect.width + OPTION.gap / 2)
    return option ? { kind: 'arrange', mode: option.mode, preview: c } : null
  }
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
  if (q.stacking) {
    const fx = (q.x - rect.x) / rect.width
    const fy = (q.y - rect.y) / rect.height
    if (Math.abs(fx - 0.5) <= STACK_ZONE && Math.abs(fy - 0.5) <= STACK_ZONE) return { kind: 'stack', targetPaneId, preview: rect }
  }
  const [side] = closest([
    ['left', (q.x - rect.x) / rect.width],
    ['right', (rect.x + rect.width - q.x) / rect.width],
    ['top', (q.y - rect.y) / rect.height],
    ['bottom', (rect.y + rect.height - q.y) / rect.height]
  ])
  return { kind: 'move', targetPaneId, side, preview: sliceRect(rect, side) }
}
