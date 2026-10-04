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
