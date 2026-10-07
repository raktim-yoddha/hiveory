import { useMemo } from 'react'
import type { KanbanCard } from '@shared/domain/kanban'
import { useCall, useCalls } from '@/core/api'

export interface AttentionItem extends KanbanCard {
  projectId: string
  projectName: string
}

/**
 * Every agent on the computer, across projects, sorted by what the user should
 * look at: the ones that need them first, then the ones at work.
 */
export const useAttention = () => {
  const projects = useCall('projects.list', undefined)
  const list = useMemo(() => projects.data ?? [], [projects.data])
  const boards = useCalls(
    'kanban.board',
    list.map((p) => ({ projectId: p.id }))
  )
  const items = useMemo(() => {
    const all: AttentionItem[] = []
    boards.forEach((board, i) => {
      const project = list[i]
      if (!board.data || !project) return
      for (const cards of Object.values(board.data)) for (const card of cards) all.push({ ...card, projectId: project.id, projectName: project.name })
    })
    return all
  }, [boards, list])
  return {
    waiting: items.filter((i) => i.runtime.status === 'waiting-for-you'),
    working: items.filter((i) => i.runtime.status === 'working'),
    idle: items.filter((i) => i.runtime.status === 'idle').length,
    projectCount: list.length,
    loading: projects.isLoading || boards.some((b) => b.isLoading),
    refresh: async () => {
      await projects.refetch()
      await Promise.all(boards.map((b) => b.refetch()))
    }
  }
}

/** How many agents need the user right now (the Inbox tab's badge). */
export const useNeedsYouCount = (): number => useAttention().waiting.length
