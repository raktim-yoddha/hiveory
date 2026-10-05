import { useRef } from 'react'
import { CLI_STATUSES } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { useFlip } from '../../lib/useFlip'
import { useNavigation } from '../../stores/navigation'
import { KanbanColumn } from './KanbanColumn'
import { useKanbanBoard } from './useKanbanBoard'
import styles from './Kanban.module.css'

/** Exactly three columns, driven by runtime state; no drag-to-change-status (AGENTS.md rules 6–7, 9). */
export function KanbanBoard({ projectId }: { projectId: string }) {
  const board = useKanbanBoard(projectId)
  const openProject = useNavigation((s) => s.openProject)
  const boardRef = useRef<HTMLDivElement>(null)
  // Cards glide to their new column when an agent's status changes.
  useFlip(boardRef)
  const total = board ? CLI_STATUSES.reduce((n, s) => n + board[s].length, 0) : 0

  return (
    <div className={styles.page}>
      {board && total === 0 && (
        <div className={styles.hint}>
          <p>Every agent in this project's workspaces shows up here, sorted by what it is doing right now.</p>
          <Button size="sm" onClick={() => openProject(projectId, 'workspaces')}>
            Go to workspaces
          </Button>
        </div>
      )}
      <div ref={boardRef} className={styles.board}>
        {CLI_STATUSES.map((status) => (
          <KanbanColumn key={status} projectId={projectId} status={status} cards={board?.[status] ?? []} />
        ))}
      </div>
    </div>
  )
}
