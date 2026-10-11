import { useEffect, useState } from 'react'
import type { KanbanBoard } from '@shared/domain'
import { api, subscribe } from '../../lib/api'
import { mirrorProjectIds } from '../../stores/data'
import { reportError } from '../../stores/notices'

/**
 * Loads the Project-scoped board from main and refreshes it whenever runtime
 * state changes — cards move only because real CLI state moved (ADR 0002).
 */
export const useKanbanBoard = (projectId: string): KanbanBoard | null => {
  const [board, setBoard] = useState<KanbanBoard | null>(null)

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = (): void => {
      api('kanban.board', { projectId })
        .then((next) => !disposed && setBoard(next))
        .catch((error) => !disposed && reportError(error, 'Load Kanban board'))
    }
    const schedule = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 60)
    }
    refresh()
    // Workspaces on the same repository share their agents (ADR 0039).
    const ours = (id?: string): boolean => Boolean(id) && mirrorProjectIds(projectId).includes(id!)
    const offs = [subscribe('runtime.changed', (e) => ours(e.projectId) && schedule()), subscribe('state.changed', (e) => ours(e.projectId) && schedule())]
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      offs.forEach((off) => off())
    }
  }, [projectId])

  return board
}
