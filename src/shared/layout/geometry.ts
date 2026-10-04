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
  /** Smallest px the subtrees on each side of this divider can take along the split axis. */
  minBefore: number
  minAfter: number
}

export interface MinPaneSize {
  width: number
  height: number
}

/** Minimum px a subtree needs: sums along its split axis, max across it. */
export const minSizeOf = (node: LayoutNode, min: MinPaneSize, gutter: number): MinPaneSize => {
  if (node.type === 'pane') return min
  const sizes = node.children.map((c) => minSizeOf(c, min, gutter))
  const gutters = gutter * (sizes.length - 1)
  return node.direction === 'horizontal'
    ? { width: sizes.reduce((s, m) => s + m.width, 0) + gutters, height: Math.max(...sizes.map((m) => m.height)) }
    : { width: Math.max(...sizes.map((m) => m.width)), height: sizes.reduce((s, m) => s + m.height, 0) + gutters }
}

export interface LayoutGeometry {
  panes: Record<string, Rect>
  dividers: Divider[]
}

/** Converts a layout tree into absolute pane rects with `gutter` px between panes. */
export const computeGeometry = (
  tree: LayoutNode | null,
  bounds: Rect,
  gutter: number,
  min: MinPaneSize = { width: 0, height: 0 }
): LayoutGeometry => {
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
        const axis = horizontal ? 'width' : 'height'
        geometry.dividers.push({
          path,
          index: i,
          direction: node.direction,
          splitRect: rect,
          ratios: node.ratios,
          minBefore: minSizeOf(child, min, gutter)[axis],
          minAfter: minSizeOf(node.children[i + 1] as LayoutNode, min, gutter)[axis],
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
 * neighbouring children change, and neither side may shrink below the
 * minimum its whole subtree needs. If the space is already too small for
 * both minimums, a squeezed side can still grow (it can never invert or collapse).
 */
export const dragDivider = (divider: Divider, delta: number, gutter: number): number[] => {
  const total =
    (divider.direction === 'horizontal' ? divider.splitRect.width : divider.splitRect.height) -
    gutter * (divider.ratios.length - 1)
  if (total <= 0 || !Number.isFinite(delta)) return divider.ratios
  const ratios = [...divider.ratios]
  const a = (ratios[divider.index] ?? 0) * total
  const b = (ratios[divider.index + 1] ?? 0) * total
  const pair = a + b
  // A side already squeezed below its minimum (window shrank) may grow but never shrink further.
  const lowest = Math.min(a, divider.minBefore)
  const highest = pair - Math.min(b, divider.minAfter)
  if (highest < lowest) return divider.ratios
  const nextA = Math.min(Math.max(a + delta, lowest), highest)
  ratios[divider.index] = nextA / total
  ratios[divider.index + 1] = (pair - nextA) / total
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

/** Nearest pane in a direction (by center distance), for keyboard rearranging. */
export const neighborOf = (
  panes: Record<string, Rect>,
  paneId: string,
  direction: 'left' | 'right' | 'up' | 'down'
): string | null => {
  const from = panes[paneId]
  if (!from) return null
  const cx = from.x + from.width / 2
  const cy = from.y + from.height / 2
  let best: { id: string; score: number } | null = null
  for (const [id, r] of Object.entries(panes)) {
    if (id === paneId) continue
    const dx = r.x + r.width / 2 - cx
    const dy = r.y + r.height / 2 - cy
    const along = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (along <= 0) continue
    const score = along + across * 2
    if (!best || score < best.score) best = { id, score }
  }
  return best?.id ?? null
}
