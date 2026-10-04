import type { ArrangeMode, LayoutNode } from '../domain/layout'
import { buildGridLayout, listPanes } from './operations'

const pane = (paneId: string): LayoutNode => ({ type: 'pane', paneId })
const evenSplit = (direction: 'horizontal' | 'vertical', ids: string[]): LayoutNode =>
  ids.length === 1
    ? pane(ids[0] as string)
    : { type: 'split', direction, children: ids.map(pane), ratios: ids.map(() => 1 / ids.length) }

export const ARRANGE_MODES: Array<{ mode: ArrangeMode; label: string; description: string }> = [
  { mode: 'equal', label: 'Equal', description: 'Divide the space as evenly as possible' },
  { mode: 'focus', label: 'Focus', description: 'Dragged pane takes half; the rest share the other half' },
  { mode: 'columns', label: 'Columns', description: 'Every pane side by side' }
]

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
        children: [pane(focus), evenSplit('vertical', rest)],
        ratios: [0.5, 0.5]
      }
    }
  }
}
