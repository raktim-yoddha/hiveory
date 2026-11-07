import type { RoutineRun, RunStatus } from '@shared/domain/routine'
import { EmptyState } from '../../components/ui/EmptyState'
import { cx } from '../../lib/cx'
import { useRoutines } from '../../stores/routines'
import { useDoerName } from './use-doer'
import { when } from './routine-text'
import styles from './Routines.module.css'

const LABEL: Record<RunStatus, string> = { running: 'Running', completed: 'Done', failed: 'Failed', missed: 'Missed', skipped: 'Skipped' }

const duration = (run: RoutineRun): string => {
  if (!run.startedAt || !run.endedAt) return ''
  const s = Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000))
  return s < 60 ? `${s}s` : `${Math.round(s / 60)} min`
}

/** What each run did: status, who, when, how long and why it failed. Newest first. */
export function RunLog({ only }: { only?: (run: RoutineRun) => boolean }) {
  const runs = useRoutines((s) => s.runs)
  const doer = useDoerName()
  const shown = only ? runs.filter(only) : runs
  if (shown.length === 0) return <EmptyState compact title="No runs yet" description="Each run of a schedule is listed here, with how it went." />
  return (
    <ul className={styles.runs} aria-label="Run log">
      {shown.map((run) => (
        <li key={run.id} className={styles.run}>
          <span className={cx(styles.status, styles[run.status])}>{LABEL[run.status]}</span>
          <span className={styles.runText}>
            <span className={styles.routineName}>{run.routineName}</span>
            <span className={styles.meta}>
              {`${doer(run)} · `}
              {when(run.scheduledFor)}
              {run.trigger === 'manual' ? ' · run by you' : ''}
              {duration(run) ? ` · ${duration(run)}` : ''}
            </span>
            {run.detail && <span className={styles.meta}>{run.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}
