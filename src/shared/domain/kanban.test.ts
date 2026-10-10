import { describe, expect, it } from 'vitest'
import { boardForWorktree, type KanbanBoard, type KanbanCard } from './kanban'

const card = (instanceId: string, workspaceId: string) => ({ instanceId, workspaceId }) as KanbanCard

describe('Kanban scope (ADR 0038)', () => {
  it('"Here" keeps only the open worktree\'s cards, in every column', () => {
    const board: KanbanBoard = { idle: [card('a', 'w1'), card('b', 'w2')], working: [card('c', 'w2')], 'waiting-for-you': [card('d', 'w1')] }
    const here = boardForWorktree(board, 'w1')
    expect(Object.fromEntries(Object.entries(here).map(([s, cards]) => [s, cards.map((c) => c.instanceId)]))).toEqual({ idle: ['a'], working: [], 'waiting-for-you': ['d'] })
  })
})
