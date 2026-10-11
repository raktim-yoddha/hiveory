import { useRef, useState } from 'react'
import { BOARD_COLUMNS, boardForWorktree } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { useFlip } from '../../lib/useFlip'
import { useNavigation } from '../../stores/navigation'
import { KanbanColumn } from './KanbanColumn'
import { useKanbanBoard } from './useKanbanBoard'
import styles from './Kanban.module.css'

/** All = every Worktree of the Workspace; Here = only the Worktree open beside it (ADR 0038). */
type Scope = 'all' | 'here'

/** Exactly three columns, driven by runtime state; no drag-to-change-status (AGENTS.md rules 6–7, 9). */
export function KanbanBoard({ projectId, workspaceId }: { projectId: string; workspaceId?: string }) {
  const loaded = useKanbanBoard(projectId)
  const [scope, setScope] = useState<Scope>('all')
  const board = loaded && workspaceId && scope === 'here' ? boardForWorktree(loaded, workspaceId) : loaded
  const setWorkspaceTab = useNavigation((s) => s.setWorkspaceTab)
  const boardRef = useRef<HTMLDivElement>(null)
  // Cards glide to their new column when an agent's status changes.
  useFlip(boardRef)
  const total = board ? BOARD_COLUMNS.reduce((n, s) => n + board[s].length, 0) : 0

  return (
    <div className={styles.page}>
      {workspaceId && (
        <div className={styles.scope}>
          <Tabs
            label="Which agents"
            variant="segmented"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All' },
              { value: 'here', label: 'Here' }
            ]}
          />
        </div>
      )}
      {board && total === 0 && (
        <div className={styles.hint}>
          <p>{scope === 'here' ? 'No agents in this worktree yet.' : "Every agent in this workspace's worktrees shows up here, sorted by what it is doing right now."}</p>
          {scope === 'all' && (
            <Button size="sm" onClick={() => setWorkspaceTab('workspaces')}>
              Go to worktrees
            </Button>
          )}
        </div>
      )}
      <div ref={boardRef} className={styles.board}>
        {BOARD_COLUMNS.map((status) => (
          <KanbanColumn key={status} projectId={projectId} status={status} cards={board?.[status] ?? []} />
        ))}
      </div>
    </div>
  )
}
