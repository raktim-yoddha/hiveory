import type { CliStatus } from '../domain'

/** One agent as a report sees it. Built from live state; nothing here comes from a model. */
export interface QueenAgentStatus {
  id: string
  petName: string
  cliName: string
  workspaceName: string
  /** Where the agent's pane lives, so a report row can jump to it. */
  projectId?: string
  workspaceId?: string
  status: CliStatus
  /** How long it has been waiting for you, when known. */
  waitingMinutes?: number
  activity?: string
}

export interface QueenReport {
  focus: 'all' | CliStatus
  total: number
  counts: Record<CliStatus, number>
  /** Longest wait first. */
  waiting: QueenAgentStatus[]
  working: QueenAgentStatus[]
  idle: QueenAgentStatus[]
}

/** Groups agents by status. Waiting agents come first in every view: they're the ones blocked on you. */
export function buildReport(agents: QueenAgentStatus[], focus: QueenReport['focus']): QueenReport {
  const of = (status: CliStatus) => agents.filter((a) => a.status === status)
  return {
    focus,
    total: agents.length,
    counts: { idle: of('idle').length, working: of('working').length, 'waiting-for-you': of('waiting-for-you').length },
    waiting: of('waiting-for-you').sort((a, b) => (b.waitingMinutes ?? 0) - (a.waitingMinutes ?? 0)),
    working: of('working'),
    idle: of('idle')
  }
}

/** "14 min", "1 h 5 min". */
export const formatWait = (minutes: number): string =>
  minutes < 60 ? `${Math.max(1, Math.round(minutes))} min` : `${Math.floor(minutes / 60)} h${minutes % 60 >= 1 ? ` ${Math.round(minutes % 60)} min` : ''}`
