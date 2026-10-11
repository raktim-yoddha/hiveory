import type { CliRuntimeDetails, CliStatus } from './cli'

/** Board columns, most urgent first: what needs you, what is running, what is resting (ADR 0039). */
export const BOARD_COLUMNS: readonly CliStatus[] = ['waiting-for-you', 'working', 'idle']

export interface KanbanCard {
  instanceId: string
  cliId: string
  petName: string
  workspaceId: string
  workspaceName: string
  runtime: CliRuntimeDetails
}

export type KanbanBoard = Record<CliStatus, KanbanCard[]>

/** The board with only one Worktree's cards: the board's "Here" (ADR 0038). */
export const boardForWorktree = (board: KanbanBoard, workspaceId: string): KanbanBoard =>
  Object.fromEntries(Object.entries(board).map(([status, cards]) => [status, cards.filter((c) => c.workspaceId === workspaceId)])) as KanbanBoard
