import { useEffect, useState } from 'react'
import { CalendarClock, FileText, Plus } from 'lucide-react'
import { isWorkRoutine, type RoutineRun } from '@shared/domain/routine'
import type { WorkspaceView } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { cx } from '../../lib/cx'
import { useClis, useWorkspaces } from '../../stores/data'
import { useRoutines } from '../../stores/routines'
import { scheduleWorkRoutine } from '../routines/open-run'
import { RoutineRow } from '../routines/RoutineRow'
import { RunLog } from '../routines/RunLog'
import routineStyles from '../routines/Routines.module.css'
import styles from './ProjectScreen.module.css'

const EMPTY: WorkspaceView[] = []

/**
 * Work's routines (ADR 0040): scheduled agents in this Workspace's worktrees, apart from the Bots
 * calendar. Each run opens a new agent with the routine's instructions; its card moves on the board.
 * The schedules, editor and run log are the routines' own (ADR 0028, 0030).
 */
export function WorkRoutinesTab({ projectId, workspaceId }: { projectId: string; workspaceId: string }) {
  const { routines, loaded, load } = useRoutines()
  const worktrees = useWorkspaces((s) => s.byProject[projectId] ?? EMPTY)
  const clis = useClis((s) => s.clis)
  const [logs, setLogs] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // By worktree, so a mirrored Workspace (ADR 0039) shows the routines of the worktrees it shows.
  const here = routines.filter(isWorkRoutine).filter((r) => worktrees.some((w) => w.id === r.target.workspaceId))
  const ours = (run: RoutineRun): boolean => here.some((r) => r.id === run.routineId)
  const who = ({ target }: (typeof here)[number]): string =>
    `${clis.find((c) => c.id === target.cliId)?.displayName ?? target.cliId} · ${worktrees.find((w) => w.id === target.workspaceId)?.name ?? 'a worktree'}`

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Routines</h2>
          <p className={styles.muted}>Agents on a schedule: each run opens a new agent in its worktree with your instructions.</p>
        </div>
        <div className={styles.headerActions}>
          <Button size="sm" variant="ghost" icon={<FileText />} aria-pressed={logs} onClick={() => setLogs(!logs)}>
            Run log
          </Button>
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => scheduleWorkRoutine(projectId, workspaceId)}>
            New routine
          </Button>
        </div>
      </div>
      {logs ? (
        <RunLog only={ours} />
      ) : here.length ? (
        <ul className={cx(routineStyles.list, styles.flush)}>
          {here.map((r) => (
            <RoutineRow key={r.id} routine={r} who={who(r)} />
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={<CalendarClock />} title="No routines yet" description="Have an agent check dependencies every Monday, run the tests each night, or review open work every morning." />
      )}
    </div>
  )
}
