import type { LayoutNode, Side, SplitDirection } from '../domain/layout'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Divider {
  /** Path of the split this divider belongs to. */
  path: number[]
  /** Divider sits between child `index` and `index + 1`. */
  index: number
  direction: SplitDirection
  rect: Rect
  /** Rect of the whole split, used to convert pointer movement into ratios. */
  splitRect: Rect
  ratios: number[]
}

export interface LayoutGeometry {
  panes: Record<string, Rect>
  dividers: Divider[]
}

/** Converts a layout tree into absolute pane rects with `gutter` px between panes. */
export const computeGeometry = (tree: LayoutNode | null, bounds: Rect, gutter: number): LayoutGeometry => {
  const geometry: LayoutGeometry = { panes: {}, dividers: [] }
  const walk = (node: LayoutNode, rect: Rect, path: number[]): void => {
    if (node.type === 'pane') {
      geometry.panes[node.paneId] = rect
      return
    }
    const horizontal = node.direction === 'horizontal'
    const total = horizontal ? rect.width : rect.height
    const available = Math.max(0, total - gutter * (node.children.length - 1))
    let offset = 0
    node.children.forEach((child, i) => {
      const size = available * (node.ratios[i] ?? 0)
      const childRect = horizontal
        ? { x: rect.x + offset, y: rect.y, width: size, height: rect.height }
        : { x: rect.x, y: rect.y + offset, width: rect.width, height: size }
      walk(child, childRect, [...path, i])
      offset += size
      if (i < node.children.length - 1) {
        geometry.dividers.push({
          path,
          index: i,
          direction: node.direction,
          splitRect: rect,
          ratios: node.ratios,
          rect: horizontal
            ? { x: rect.x + offset, y: rect.y, width: gutter, height: rect.height }
            : { x: rect.x, y: rect.y + offset, width: rect.width, height: gutter }
        })
        offset += gutter
      }
    })
  }
  if (tree) walk(tree, bounds, [])
  return geometry
}

/**
 * New ratios after dragging divider `index` by `delta` px. Only the two
 * neighbouring children change; `minRatio` keeps either from collapsing.
 */
export const dragDivider = (divider: Divider, delta: number, gutter: number, minRatio: number): number[] => {
  const total =
    (divider.direction === 'horizontal' ? divider.splitRect.width : divider.splitRect.height) -
    gutter * (divider.ratios.length - 1)
  if (total <= 0) return divider.ratios
  const ratios = [...divider.ratios]
  const a = ratios[divider.index] ?? 0
  const b = ratios[divider.index + 1] ?? 0
  const pair = a + b
  const nextA = Math.min(Math.max(a + delta / total, minRatio), pair - minRatio)
  ratios[divider.index] = nextA
  ratios[divider.index + 1] = pair - nextA
  return ratios
}

export const containsPoint = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height

/** The half (or `fraction`) of `rect` on `side`. */
export const sliceRect = (rect: Rect, side: Side, fraction = 0.5): Rect => {
  switch (side) {
    case 'left':
      return { ...rect, width: rect.width * fraction }
    case 'right':
      return { ...rect, x: rect.x + rect.width * (1 - fraction), width: rect.width * fraction }
    case 'top':
      return { ...rect, height: rect.height * fraction }
    case 'bottom':
      return { ...rect, y: rect.y + rect.height * (1 - fraction), height: rect.height * fraction }
  }
}
