import type { CliRuntimeDetails, CliStatus } from './cli'

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
