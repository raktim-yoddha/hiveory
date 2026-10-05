import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '../domain/layout'
import { arrangeBarRects, resolveDropTarget } from './drop'
import { computeGeometry, dragDivider, minSizeOf, neighborOf } from './geometry'
import { arrange, focusRest } from './presets'
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

  it('converts divider drags into ratios, never below the minimum size', () => {
    const g = computeGeometry(h(p('a'), p('b')), { x: 0, y: 0, width: 210, height: 100 }, 10, { width: 20, height: 20 })
    const divider = g.dividers[0]!
    expect(dragDivider(divider, 50, 10)).toEqual([0.75, 0.25])
    expect(dragDivider(divider, 1000, 10)[1]).toBeCloseTo(0.1)
    expect(dragDivider(divider, -1000, 10)[0]).toBeCloseTo(0.1)
    expect(dragDivider(divider, Number.NaN, 10)).toEqual(divider.ratios)
  })

  it('respects whole-subtree minimums for nested splits', () => {
    const tree: LayoutNode = { type: 'split', direction: 'horizontal', children: [p('a'), h(p('b'), p('c'))], ratios: [0.5, 0.5] }
    const g = computeGeometry(tree, { x: 0, y: 0, width: 1010, height: 100 }, 10, { width: 200, height: 50 })
    const outer = g.dividers.find((d) => d.path.length === 0)!
    expect(outer.minAfter).toBe(410)
    // Pushing far right stops where b and c still have 200px each.
    const ratios = dragDivider(outer, 5000, 10)
    expect(Math.round((ratios[1] ?? 0) * 1000)).toBe(410)
  })

  it('lets a squeezed side grow but never shrink further', () => {
    const g = computeGeometry(h(p('a'), p('b')), { x: 0, y: 0, width: 210, height: 100 }, 10, { width: 150, height: 20 })
    const divider = g.dividers[0]!
    expect(dragDivider(divider, -20, 10)).toEqual(divider.ratios)
    expect(minSizeOf(h(p('a'), p('b')), { width: 150, height: 20 }, 10)).toEqual({ width: 310, height: 20 })
  })

  it('finds neighbours by direction', () => {
    const g = computeGeometry(insertBeside(h(p('a'), p('b')), 'c', 'b', 'bottom'), { x: 0, y: 0, width: 210, height: 210 }, 10)
    expect(neighborOf(g.panes, 'a', 'right')).toBe('b')
    expect(neighborOf(g.panes, 'b', 'down')).toBe('c')
    expect(neighborOf(g.panes, 'a', 'left')).toBeNull()
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

describe('arrange modes', () => {
  const tree = insertBeside(h(p('a'), p('b'), p('c')), 'd', 'a', 'bottom')

  it('equal builds a near-square grid in pane order', () => {
    const out = arrange(tree, 'equal')
    expect(listPanes(out)).toEqual(listPanes(tree))
    expect(out).toMatchObject({ direction: 'vertical' })
  })

  it('focus gives the focused pane exactly half and stacks the rest equally', () => {
    const out = arrange(tree, 'focus', 'c') as Extract<LayoutNode, { type: 'split' }>
    expect(out.children[0]).toEqual(p('c'))
    expect(out.ratios).toEqual([0.5, 0.5])
    const rest = out.children[1] as Extract<LayoutNode, { type: 'split' }>
    expect(rest.direction).toBe('vertical')
    rest.ratios.forEach((r) => expect(r).toBeCloseTo(1 / 3))
  })

  it('columns puts every pane side by side; single panes stay single', () => {
    expect(arrange(tree, 'columns')).toMatchObject({ direction: 'horizontal', ratios: [0.25, 0.25, 0.25, 0.25] })
    expect(arrange(p('a'), 'focus', 'a')).toEqual(p('a'))
    expect(arrange(null, 'equal')).toBeNull()
    expect(applyOperation(tree, { type: 'arrange', mode: 'columns' })).toMatchObject({ direction: 'horizontal' })
  })

  it('the top band resolves to the option under the pointer', () => {
    const panes = { a: { x: 0, y: 0, width: 500, height: 600 }, b: { x: 510, y: 0, width: 490, height: 600 } }
    const container = { x: 0, y: 0, width: 1000, height: 600 }
    const [equal, focus] = arrangeBarRects(container)
    expect(resolveDropTarget({ panes, container, draggedPaneId: 'a', swap: false, x: focus!.rect.x + 10, y: 20 })).toMatchObject({
      kind: 'arrange',
      mode: 'focus'
    })
    expect(resolveDropTarget({ panes, container, draggedPaneId: 'a', swap: false, x: equal!.rect.x + 5, y: 60 })).toMatchObject({ mode: 'equal' })
    expect(resolveDropTarget({ panes, container, draggedPaneId: 'a', swap: false, x: 5, y: 20 })).toBeNull()
    // Holding Space ignores the bar and swaps instead.
    expect(resolveDropTarget({ panes, container, draggedPaneId: 'a', swap: true, x: 700, y: 20 })).toMatchObject({ kind: 'swap' })
  })
})

describe('focus arrangement with many panes', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`)
  const columnSizes = (node: LayoutNode): number[] =>
    node.type === 'split' && node.direction === 'horizontal' && node.children.every((c) => c.type === 'split' && c.direction === 'vertical')
      ? node.children.map((c) => (c.type === 'split' ? c.children.length : 1))
      : []

  it('stacks up to four panes beside the focused one', () => {
    const rest = focusRest(ids(4))
    expect(rest.type === 'split' && rest.direction === 'vertical' && rest.children.length).toBe(4)
  })

  it('puts five or more into columns of up to four in the same half: 3+2, 4+4, 3+3+3', () => {
    expect(columnSizes(focusRest(ids(5)))).toEqual([3, 2])
    expect(columnSizes(focusRest(ids(8)))).toEqual([4, 4])
    expect(columnSizes(focusRest(ids(9)))).toEqual([3, 3, 3])
    const tree = arrange(buildGridLayout(ids(9)), 'focus', 'p0')
    expect(tree?.type === 'split' && tree.ratios).toEqual([0.5, 0.5])
    expect(listPanes(tree)).toHaveLength(9)
  })
})
