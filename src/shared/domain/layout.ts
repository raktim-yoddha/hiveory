/**
 * Recursive pane layout. `horizontal` lays children out left-to-right,
 * `vertical` top-to-bottom. Layout nodes never know what a pane contains.
 */
export type LayoutNode =
  /**
   * One area. `tabs` (ADR 0042): several panes stacked in it as tabs, in order; `paneId` is the one
   * shown. Without `tabs` it holds just `paneId`.
   */
  | { type: 'pane'; paneId: string; tabs?: string[] }
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
  /** Puts a pane into another pane's area as a tab, and shows it (ADR 0042). */
  | { type: 'stack'; paneId: string; targetPaneId: string }
  /** Shows a pane in its area (its tab is chosen). */
  | { type: 'activate'; paneId: string }
