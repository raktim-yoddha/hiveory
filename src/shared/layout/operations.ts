import type { LayoutNode, LayoutOperation, Side, SplitDirection } from '../domain/layout'
import { arrange } from './presets'

/** Smallest share a split child may take; the renderer additionally enforces pixel minimums. */
export const MIN_RATIO = 0.08

type Split = Extract<LayoutNode, { type: 'split' }>
type Leaf = Extract<LayoutNode, { type: 'pane' }>

const pane = (paneId: string): LayoutNode => ({ type: 'pane', paneId })
/** An area of panes shown as tabs, or a plain pane when only one is left (ADR 0042). */
const leaf = (tabs: string[], active: string): Leaf => (tabs.length > 1 ? { type: 'pane', paneId: tabs.includes(active) ? active : tabs[0]!, tabs } : { type: 'pane', paneId: tabs[0] ?? active })

/** Every pane of an area, in tab order. */
export const leafPanes = (node: Leaf): string[] => node.tabs ?? [node.paneId]
const split = (direction: SplitDirection, children: LayoutNode[], ratios?: number[]): Split => ({
  type: 'split',
  direction,
  children,
  ratios: ratios ?? children.map(() => 1 / children.length)
})

export const directionOf = (side: Side): SplitDirection =>
  side === 'left' || side === 'right' ? 'horizontal' : 'vertical'
const isLeading = (side: Side): boolean => side === 'left' || side === 'top'

const normalizeRatios = (ratios: number[]): number[] => {
  const sum = ratios.reduce((a, b) => a + b, 0)
  return sum > 0 ? ratios.map((r) => r / sum) : ratios.map(() => 1 / ratios.length)
}

export const listPanes = (tree: LayoutNode | null): string[] =>
  !tree ? [] : tree.type === 'pane' ? leafPanes(tree) : tree.children.flatMap(listPanes)

/** Each pane's area: its tabs in order and the one shown (a plain pane is an area of one). */
export const paneGroups = (tree: LayoutNode | null): Record<string, { paneIds: string[]; active: string }> => {
  const out: Record<string, { paneIds: string[]; active: string }> = {}
  const walk = (node: LayoutNode): void => {
    if (node.type === 'split') return node.children.forEach(walk)
    const group = { paneIds: leafPanes(node), active: node.paneId }
    for (const id of group.paneIds) out[id] = group
  }
  if (tree) walk(tree)
  return out
}

export const containsPane = (tree: LayoutNode | null, paneId: string): boolean =>
  listPanes(tree).includes(paneId)

/**
 * Collapses single-child splits, merges nested splits that share a direction
 * and keeps ratios summing to 1. Every operation returns a normalized tree.
 */
export const normalize = (tree: LayoutNode | null): LayoutNode | null => {
  if (!tree || tree.type === 'pane') return tree
  const children: LayoutNode[] = []
  const ratios: number[] = []
  tree.children.forEach((child, i) => {
    const node = normalize(child)
    const ratio = tree.ratios[i] ?? 1 / tree.children.length
    if (!node) return
    if (node.type === 'split' && node.direction === tree.direction) {
      node.children.forEach((c, j) => {
        children.push(c)
        ratios.push(ratio * (node.ratios[j] ?? 0))
      })
    } else {
      children.push(node)
      ratios.push(ratio)
    }
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0] ?? null
  return split(tree.direction, children, normalizeRatios(ratios))
}

export const removePane = (tree: LayoutNode | null, paneId: string): LayoutNode | null => {
  if (!tree) return null
  if (tree.type === 'pane') {
    const tabs = leafPanes(tree)
    if (!tabs.includes(paneId)) return tree
    const rest = tabs.filter((id) => id !== paneId)
    if (!rest.length) return null
    // The neighbour tab takes over when the shown one goes, as in a browser.
    const index = tabs.indexOf(paneId)
    return leaf(rest, tree.paneId === paneId ? (rest[index] ?? rest[index - 1]!) : tree.paneId)
  }
  const kept = tree.children
    .map((child, i) => ({ node: removePane(child, paneId), ratio: tree.ratios[i] ?? 0 }))
    .filter((c): c is { node: LayoutNode; ratio: number } => c.node !== null)
  return normalize(
    split(
      tree.direction,
      kept.map((c) => c.node),
      kept.map((c) => c.ratio)
    )
  )
}

/** Docks a pane along an outer edge of the whole layout. */
export const dockPane = (tree: LayoutNode | null, paneId: string, side: Side): LayoutNode | null => {
  if (!tree) return pane(paneId)
  const direction = directionOf(side)
  if (tree.type === 'split' && tree.direction === direction) {
    const n = tree.children.length
    const scaled = tree.ratios.map((r) => (r * n) / (n + 1))
    const share = 1 / (n + 1)
    return isLeading(side)
      ? split(direction, [pane(paneId), ...tree.children], [share, ...scaled])
      : split(direction, [...tree.children, pane(paneId)], [...scaled, share])
  }
  return split(direction, isLeading(side) ? [pane(paneId), tree] : [tree, pane(paneId)])
}

/** Places a new pane beside `targetPaneId`, taking half of the target's space. */
export const insertBeside = (
  tree: LayoutNode | null,
  newPaneId: string,
  targetPaneId: string,
  side: Side
): LayoutNode | null => {
  if (!tree) return pane(newPaneId)
  if (!containsPane(tree, targetPaneId)) return dockPane(tree, newPaneId, side)
  const replace = (node: LayoutNode): LayoutNode => {
    if (node.type === 'pane') {
      if (!leafPanes(node).includes(targetPaneId)) return node
      const pair = isLeading(side) ? [pane(newPaneId), node] : [node, pane(newPaneId)]
      return split(directionOf(side), pair)
    }
    return { ...node, children: node.children.map(replace) }
  }
  return normalize(replace(tree))
}

export const swapPanes = (tree: LayoutNode | null, a: string, b: string): LayoutNode | null => {
  if (!tree || a === b) return tree
  if (tree.type === 'pane') {
    const swap = (id: string): string => (id === a ? b : id === b ? a : id)
    return tree.tabs ? { type: 'pane', paneId: swap(tree.paneId), tabs: tree.tabs.map(swap) } : tree.paneId === a || tree.paneId === b ? pane(swap(tree.paneId)) : tree
  }
  return { ...tree, children: tree.children.map((c) => swapPanes(c, a, b) as LayoutNode) }
}

/** Moves a pane into the area of `targetPaneId` as its last tab and shows it (ADR 0042). */
export const stackPane = (tree: LayoutNode | null, paneId: string, targetPaneId: string): LayoutNode | null => {
  if (!tree || paneId === targetPaneId || !containsPane(tree, targetPaneId)) return tree
  const without = containsPane(tree, paneId) ? removePane(tree, paneId) : tree
  const add = (node: LayoutNode): LayoutNode => {
    if (node.type === 'split') return { ...node, children: node.children.map(add) }
    const tabs = leafPanes(node)
    return tabs.includes(targetPaneId) ? leaf([...tabs, paneId], paneId) : node
  }
  return without ? add(without) : pane(paneId)
}

/** Every area's tabs laid out side by side again (back to the tiles style, ADR 0042). */
export const flattenTabs = (tree: LayoutNode | null): LayoutNode | null => {
  if (!tree) return tree
  if (tree.type === 'pane') return tree.tabs ? split('horizontal', tree.tabs.map(pane)) : tree
  return normalize({ ...tree, children: tree.children.map((c) => flattenTabs(c) as LayoutNode) })
}

/** Shows a pane in its area (chooses its tab). */
export const activatePane = (tree: LayoutNode | null, paneId: string): LayoutNode | null => {
  if (!tree) return tree
  if (tree.type === 'pane') return tree.tabs?.includes(paneId) && tree.paneId !== paneId ? { ...tree, paneId } : tree
  const children = tree.children.map((c) => activatePane(c, paneId) as LayoutNode)
  return children.every((c, i) => c === tree.children[i]) ? tree : { ...tree, children }
}

export const getNode = (tree: LayoutNode | null, path: number[]): LayoutNode | null =>
  path.reduce<LayoutNode | null>(
    (node, index) => (node?.type === 'split' ? (node.children[index] ?? null) : null),
    tree
  )

/** Sets the ratios of the split at `path`. Invalid input leaves the tree unchanged. */
export const resizeSplit = (tree: LayoutNode | null, path: number[], ratios: number[]): LayoutNode | null => {
  const target = getNode(tree, path)
  if (!tree || target?.type !== 'split' || target.children.length !== ratios.length) return tree
  if (ratios.some((r) => !Number.isFinite(r) || r <= 0)) return tree
  const next = normalizeRatios(normalizeRatios(ratios).map((r) => Math.max(r, MIN_RATIO)))
  const update = (node: LayoutNode, depth: number): LayoutNode => {
    if (node.type !== 'split') return node
    if (depth === path.length) return { ...node, ratios: next }
    const index = path[depth]
    return { ...node, children: node.children.map((c, i) => (i === index ? update(c, depth + 1) : c)) }
  }
  return update(tree, 0)
}

export const applyOperation = (tree: LayoutNode | null, op: LayoutOperation): LayoutNode | null => {
  switch (op.type) {
    case 'move':
      if (op.paneId === op.targetPaneId || !containsPane(tree, op.paneId) || !containsPane(tree, op.targetPaneId)) {
        return tree
      }
      return insertBeside(removePane(tree, op.paneId), op.paneId, op.targetPaneId, op.side)
    case 'dock':
      if (!containsPane(tree, op.paneId)) return tree
      return dockPane(removePane(tree, op.paneId), op.paneId, op.side)
    case 'swap':
      if (!containsPane(tree, op.paneId) || !containsPane(tree, op.targetPaneId)) return tree
      return swapPanes(tree, op.paneId, op.targetPaneId)
    case 'resize':
      return resizeSplit(tree, op.path, op.ratios)
    case 'arrange':
      return arrange(tree, op.mode, op.focusPaneId)
    case 'stack':
      return stackPane(tree, op.paneId, op.targetPaneId)
    case 'activate':
      return activatePane(tree, op.paneId)
  }
}

/** Initial arrangement for several new panes: one row up to 3, then a near-square grid. */
export const buildGridLayout = (paneIds: string[]): LayoutNode | null => {
  if (paneIds.length === 0) return null
  if (paneIds.length === 1) return pane(paneIds[0] as string)
  if (paneIds.length <= 3) return split('horizontal', paneIds.map(pane))
  const columns = Math.ceil(Math.sqrt(paneIds.length))
  const rows: LayoutNode[] = []
  for (let i = 0; i < paneIds.length; i += columns) {
    const row = paneIds.slice(i, i + columns)
    rows.push(row.length === 1 ? pane(row[0] as string) : split('horizontal', row.map(pane)))
  }
  return split('vertical', rows)
}
