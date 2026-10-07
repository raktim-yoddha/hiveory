import { describe, expect, it } from 'vitest'
import type { Handoff } from '@shared/domain/bot'
import type { RoutineRun } from '@shared/domain/routine'
import { workBoard } from './work-board'

const NOW = Date.parse('2026-10-08T12:00:00Z')
const hoursAgo = (h: number): string => new Date(NOW - h * 3_600_000).toISOString()

const handoff = (over: Partial<Handoff>): Handoff => ({ fromBotId: 'chief', toBotId: 'scout', threadId: 't1', title: 'From Chief: research', running: false, updatedAt: hoursAgo(1), ...over })
const run = (over: Partial<RoutineRun>): RoutineRun => ({
  id: 'r1',
  routineId: 'x',
  routineName: 'Morning brief',
  botId: 'scout',
  trigger: 'schedule',
  prompt: '',
  scheduledFor: hoursAgo(1),
  status: 'completed',
  endedAt: hoursAgo(1),
  ...over
})

describe('work board', () => {
  it('puts work in the column of its real state', () => {
    const board = workBoard(
      [handoff({ threadId: 'a', running: true }), handoff({ threadId: 'b' })],
      [run({ id: 'go', status: 'running', startedAt: hoursAgo(0.1) }), run({ id: 'f', status: 'failed', detail: 'Timed out' }), run({ id: 'm', status: 'missed' }), run({ id: 'ok' })],
      NOW
    )
    expect(board.working.map((i) => i.key)).toEqual(['r-go', 'h-a'])
    expect(board.unfinished.map((i) => i.key).sort()).toEqual(['r-f', 'r-m'])
    expect(board.done.map((i) => i.key).sort()).toEqual(['h-b', 'r-ok'])
  })

  it('names who asked: a bot, a routine or a trigger', () => {
    const board = workBoard([handoff({})], [run({ id: 'e', trigger: 'event', routineName: 'New issue' }), run({ id: 's' })], NOW)
    expect(board.done.map((i) => i.from)).toEqual(expect.arrayContaining([{ kind: 'bot', botId: 'chief' }, { kind: 'trigger', name: 'New issue' }, { kind: 'routine', name: 'Morning brief' }]))
  })

  it('drops finished work after a day but keeps long-running work', () => {
    const board = workBoard([handoff({ running: true, updatedAt: hoursAgo(30) })], [run({ endedAt: hoursAgo(25) }), run({ id: 'f', status: 'failed', endedAt: hoursAgo(26) })], NOW)
    expect(board.working).toHaveLength(1)
    expect(board.done).toHaveLength(0)
    expect(board.unfinished).toHaveLength(0)
  })
})
