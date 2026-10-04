/** The only Kanban/runtime statuses (AGENTS.md rule 6). */
export const CLI_STATUSES = ['idle', 'working', 'waiting-for-you'] as const
export type CliStatus = (typeof CLI_STATUSES)[number]

export type WaitingReason = 'permission' | 'input' | 'confirmation' | 'other'

export interface CliRuntimeDetails {
  status: CliStatus
  waitingReason?: WaitingReason
  /** Short human-readable description of what is happening. */
  activity?: string
  /** Diagnostic message; errors never create a fourth status. */
  error?: string
  /** Whether a process is currently attached to the instance. */
  running: boolean
}

export type IconReference =
  | { kind: 'svg'; viewBox: string; path: string; color: string }
  /** Official mark as a data URI (bundled, never fetched at runtime). */
  | { kind: 'image'; src: string }
  | { kind: 'monogram'; text: string; color?: string }

/** Normalized CLI metadata the UI consumes. Provider specifics stay in main-process adapters. */
export interface CliDescriptor {
  id: string
  displayName: string
  icon: IconReference
  supportsAutoApprove: boolean
  available: boolean
  /** Resolved executable path when available. */
  executable?: string
}

/** A configured agent instance. Its pane id in the layout tree is the instance id. */
export interface CliInstance {
  id: string
  projectId: string
  workspaceId: string
  cliId: string
  petName: string
  conversationId: string
  /** True once the conversation has received a prompt, so it can be resumed. */
  hasConversation: boolean
  autoApprove: boolean
  createdAt: string
}

export interface CliInstanceView extends CliInstance {
  runtime: CliRuntimeDetails
}

export interface CliSelection {
  cliId: string
  count: number
}
