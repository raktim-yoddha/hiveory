/**
 * Recursive pane layout. `horizontal` lays children out left-to-right,
 * `vertical` top-to-bottom. Layout nodes never know what a pane contains.
 */
export type LayoutNode =
  | { type: 'pane'; paneId: string }
  | { type: 'split'; direction: SplitDirection; children: LayoutNode[]; ratios: number[] }

export type SplitDirection = 'horizontal' | 'vertical'
export type ArrangeMode = 'equal' | 'focus' | 'columns'
export type Side = 'left' | 'right' | 'top' | 'bottom'

export type LayoutOperation =
  | { type: 'move'; paneId: string; targetPaneId: string; side: Side }
  | { type: 'dock'; paneId: string; side: Side }
  | { type: 'swap'; paneId: string; targetPaneId: string }
  | { type: 'resize'; path: number[]; ratios: number[] }
  | { type: 'arrange'; mode: ArrangeMode; focusPaneId?: string }
