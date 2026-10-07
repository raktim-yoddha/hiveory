import type { Handoff } from '@shared/domain/bot'
import type { RoutineRun } from '@shared/domain/routine'

/** How far back finished work stays on the board (ADR 0028: Bots history is allowed, capped). */
export const BOARD_WINDOW_MS = 24 * 60 * 60 * 1000

export type WorkColumn = 'working' | 'unfinished' | 'done'

export interface WorkItem {
  key: string
  column: WorkColumn
  /** The bot doing the work; absent for a scheduled chat or a Work routine (see `where`). */
  botId?: string
  /** Who did it when it isn't a bot: "Codex in a new chat". */
  where?: string
  /** Who asked for it: another bot, a routine or a trigger. */
  from: { kind: 'bot'; botId: string } | { kind: 'routine' | 'trigger'; name: string }
  title: string
  /** When it started (working) or last changed (finished). */
  at: string
  threadId?: string
  detail?: string
}

const runColumn = (run: RoutineRun): WorkColumn => (run.status === 'running' ? 'working' : run.status === 'completed' ? 'done' : 'unfinished')

/**
 * The work board (ADR 0028, K1): work the team owes, derived from handoffs and runs. Columns follow
 * real state (rule 7): nothing is dragged, and finished work drops off after a day.
 */
export function workBoard(handoffs: Handoff[], runs: RoutineRun[], now: number): Record<WorkColumn, WorkItem[]> {
  const items: WorkItem[] = [
    ...handoffs.map(
      (h): WorkItem => ({
        key: `h-${h.threadId}`,
        column: h.running ? 'working' : 'done',
        botId: h.toBotId,
        from: { kind: 'bot', botId: h.fromBotId },
        title: h.title,
        at: h.updatedAt,
        threadId: h.threadId
      })
    ),
    ...runs.map(
      (r): WorkItem => ({
        key: `r-${r.id}`,
        column: runColumn(r),
        ...(r.botId ? { botId: r.botId } : { where: r.where ?? 'Nobody' }),
        from: { kind: r.trigger === 'event' ? 'trigger' : 'routine', name: r.routineName },
        title: r.routineName,
        at: r.status === 'running' ? (r.startedAt ?? r.scheduledFor) : (r.endedAt ?? r.scheduledFor),
        ...(r.threadId ? { threadId: r.threadId } : {}),
        ...(r.detail ? { detail: r.detail } : {})
      })
    )
  ]
  const board: Record<WorkColumn, WorkItem[]> = { working: [], unfinished: [], done: [] }
  for (const item of items) {
    if (item.column !== 'working' && now - Date.parse(item.at) > BOARD_WINDOW_MS) continue
    board[item.column].push(item)
  }
  for (const column of Object.values(board)) column.sort((a, b) => b.at.localeCompare(a.at))
  return board
}
