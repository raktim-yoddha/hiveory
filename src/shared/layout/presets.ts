import type { ArrangeMode, LayoutNode } from '../domain/layout'
import { buildGridLayout, listPanes } from './operations'

const pane = (paneId: string): LayoutNode => ({ type: 'pane', paneId })
const evenSplit = (direction: 'horizontal' | 'vertical', ids: string[]): LayoutNode =>
  ids.length === 1
    ? pane(ids[0] as string)
    : { type: 'split', direction, children: ids.map(pane), ratios: ids.map(() => 1 / ids.length) }

export const ARRANGE_MODES: Array<{ mode: ArrangeMode; label: string; description: string }> = [
  { mode: 'equal', label: 'Equal', description: 'Divide the space as evenly as possible' },
  { mode: 'focus', label: 'Focus', description: 'Dragged pane takes half; the rest share the other half (in columns of up to four)' },
  { mode: 'columns', label: 'Columns', description: 'Every pane side by side' }
]

/** At most this many panes stack in one column of the focus layout's other half. */
const FOCUS_COLUMN_MAX = 4

/**
 * The non-focused half of the focus layout: one column of up to four stacked panes;
 * more become side-by-side columns of at most four, fullest first
 * (5 → 3 + 2, 8 → 4 + 4, 9 → 3 + 3 + 3).
 */
export const focusRest = (ids: string[]): LayoutNode => {
  if (ids.length <= FOCUS_COLUMN_MAX) return evenSplit('vertical', ids)
  const columns = Math.ceil(ids.length / FOCUS_COLUMN_MAX)
  const base = Math.floor(ids.length / columns)
  const extra = ids.length % columns
  let at = 0
  const children = Array.from({ length: columns }, (_, c) => {
    const size = base + (c < extra ? 1 : 0)
    const column = ids.slice(at, at + size)
    at += size
    return evenSplit('vertical', column)
  })
  return { type: 'split', direction: 'horizontal', children, ratios: children.map(() => 1 / columns) }
}

/**
 * Whole-layout arrangements (drag a pane to the top edge). Pane order is kept;
 * in `focus` mode the focused pane leads and gets exactly half the width.
 */
export const arrange = (tree: LayoutNode | null, mode: ArrangeMode, focusPaneId?: string): LayoutNode | null => {
  const ids = listPanes(tree)
  if (ids.length === 0) return null
  switch (mode) {
    case 'equal':
      return buildGridLayout(ids)
    case 'columns':
      return evenSplit('horizontal', ids)
    case 'focus': {
      const focus = focusPaneId && ids.includes(focusPaneId) ? focusPaneId : (ids[0] as string)
      const rest = ids.filter((id) => id !== focus)
      if (rest.length === 0) return pane(focus)
      return {
        type: 'split',
        direction: 'horizontal',
        children: [pane(focus), focusRest(rest)],
        ratios: [0.5, 0.5]
      }
    }
  }
}
