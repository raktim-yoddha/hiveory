import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '../domain/layout'
import { resolveDropTarget } from './drop'
import { computeGeometry, dragDivider } from './geometry'
import {
  applyOperation,
  buildGridLayout,
  dockPane,
  insertBeside,
  listPanes,
  normalize,
  removePane,
  resizeSplit
} from './operations'

const p = (paneId: string): LayoutNode => ({ type: 'pane', paneId })
const h = (...children: LayoutNode[]): LayoutNode => ({
  type: 'split',
  direction: 'horizontal',
  children,
  ratios: children.map(() => 1 / children.length)
})

describe('layout operations', () => {
  it('splits right and bottom', () => {
    const right = insertBeside(p('a'), 'b', 'a', 'right')
    expect(right).toEqual(h(p('a'), p('b')))
    const bottom = insertBeside(right, 'c', 'b', 'bottom')
    expect(bottom).toMatchObject({
      type: 'split',
      direction: 'horizontal',
      children: [p('a'), { type: 'split', direction: 'vertical', children: [p('b'), p('c')] }]
    })
  })

  it('flattens same-direction splits and halves the target share', () => {
    const tree = insertBeside(h(p('a'), p('b')), 'c', 'b', 'right')
    expect(listPanes(tree)).toEqual(['a', 'b', 'c'])
    expect(tree).toMatchObject({ type: 'split', ratios: [0.5, 0.25, 0.25] })
  })

  it('removes panes and collapses single-child splits', () => {
    expect(removePane(h(p('a'), p('b')), 'b')).toEqual(p('a'))
    expect(removePane(p('a'), 'a')).toBeNull()
  })

  it('docks to the outer edge with an even share', () => {
    const tree = dockPane(h(p('a'), p('b')), 'c', 'left')
    expect(listPanes(tree)).toEqual(['c', 'a', 'b'])
    const ratios = (tree as Extract<LayoutNode, { type: 'split' }>).ratios
    ratios.forEach((r) => expect(r).toBeCloseTo(1 / 3))
    expect(dockPane(p('a'), 'b', 'bottom')).toMatchObject({ direction: 'vertical', children: [p('a'), p('b')] })
  })

  it('moves a pane beside another', () => {
    const tree = applyOperation(h(p('a'), p('b'), p('c')), { type: 'move', paneId: 'a', targetPaneId: 'c', side: 'bottom' })
    expect(listPanes(tree)).toEqual(['b', 'c', 'a'])
    expect(tree).toMatchObject({ children: [p('b'), { direction: 'vertical', children: [p('c'), p('a')] }] })
  })

  it('swaps two panes without changing structure', () => {
    const before = insertBeside(h(p('a'), p('b')), 'c', 'b', 'bottom')
    const after = applyOperation(before, { type: 'swap', paneId: 'a', targetPaneId: 'c' })
    expect(listPanes(after)).toEqual(['c', 'b', 'a'])
    expect(JSON.stringify(after).replace(/"[abc]"/g, '_')).toBe(JSON.stringify(before).replace(/"[abc]"/g, '_'))
  })

  it('ignores operations on unknown panes or self', () => {
    const tree = h(p('a'), p('b'))
    expect(applyOperation(tree, { type: 'move', paneId: 'a', targetPaneId: 'a', side: 'left' })).toBe(tree)
    expect(applyOperation(tree, { type: 'swap', paneId: 'a', targetPaneId: 'zz' })).toBe(tree)
    expect(applyOperation(tree, { type: 'dock', paneId: 'zz', side: 'left' })).toBe(tree)
  })

  it('resizes with clamping and rejects bad input', () => {
    const tree = h(p('a'), p('b'))
    expect(resizeSplit(tree, [], [3, 1])).toMatchObject({ ratios: [0.75, 0.25] })
    const clamped = resizeSplit(tree, [], [1, 0.0001]) as Extract<LayoutNode, { type: 'split' }>
    expect(clamped.ratios[1]).toBeGreaterThan(0.05)
    expect(resizeSplit(tree, [], [1])).toBe(tree)
    expect(resizeSplit(tree, [], [1, -1])).toBe(tree)
    expect(resizeSplit(tree, [0], [1, 1])).toBe(tree)
  })

  it('normalizes nested structures', () => {
    const nested: LayoutNode = { type: 'split', direction: 'horizontal', children: [p('a'), h(p('b'), p('c'))], ratios: [0.5, 0.5] }
    expect(normalize(nested)).toMatchObject({ children: [p('a'), p('b'), p('c')], ratios: [0.5, 0.25, 0.25] })
  })

  it('builds rows and grids', () => {
    expect(buildGridLayout([])).toBeNull()
    expect(buildGridLayout(['a'])).toEqual(p('a'))
    expect(buildGridLayout(['a', 'b', 'c'])).toMatchObject({ direction: 'horizontal' })
    const grid = buildGridLayout(['a', 'b', 'c', 'd', 'e'])
    expect(grid).toMatchObject({ direction: 'vertical' })
    expect(listPanes(grid)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('layout geometry', () => {
  it('lays panes out with gutters', () => {
    const g = computeGeometry(h(p('a'), p('b')), { x: 0, y: 0, width: 210, height: 100 }, 10)
    expect(g.panes.a).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(g.panes.b).toEqual({ x: 110, y: 0, width: 100, height: 100 })
    expect(g.dividers).toHaveLength(1)
    expect(g.dividers[0]?.rect).toEqual({ x: 100, y: 0, width: 10, height: 100 })
  })

  it('converts divider drags into ratios with a floor', () => {
    const g = computeGeometry(h(p('a'), p('b')), { x: 0, y: 0, width: 210, height: 100 }, 10)
    const divider = g.dividers[0]!
    expect(dragDivider(divider, 50, 10, 0.1)).toEqual([0.75, 0.25])
    expect(dragDivider(divider, 1000, 10, 0.1)[1]).toBeCloseTo(0.1)
  })
})

describe('drop targets', () => {
  const panes = { a: { x: 0, y: 0, width: 100, height: 100 }, b: { x: 110, y: 0, width: 100, height: 100 } }
  const container = { x: 0, y: 0, width: 210, height: 100 }
  const base = { panes, container, draggedPaneId: 'a', edgeThreshold: 8 }

  it('docks near the container edge', () => {
    expect(resolveDropTarget({ ...base, x: 205, y: 50, swap: false })).toMatchObject({ kind: 'dock', side: 'right' })
  })

  it('moves beside the nearest edge of another pane', () => {
    expect(resolveDropTarget({ ...base, x: 160, y: 85, swap: false })).toMatchObject({
      kind: 'move',
      targetPaneId: 'b',
      side: 'bottom'
    })
  })

  it('swaps when Space is held, even near edges', () => {
    expect(resolveDropTarget({ ...base, x: 205, y: 50, swap: true })).toMatchObject({ kind: 'swap', targetPaneId: 'b' })
  })

  it('returns nothing over the dragged pane or with a single pane', () => {
    expect(resolveDropTarget({ ...base, x: 50, y: 50, swap: false })).toBeNull()
    expect(resolveDropTarget({ ...base, panes: { a: panes.a }, x: 205, y: 50, swap: false })).toBeNull()
  })
})
