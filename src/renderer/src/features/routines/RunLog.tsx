import { MessageSquare } from 'lucide-react'
import type { RoutineRun, RunStatus } from '@shared/domain/routine'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { cx } from '../../lib/cx'
import { useBots } from '../../stores/bots'
import { useRoutines } from '../../stores/routines'
import { when } from './routine-text'
import styles from './Routines.module.css'

const LABEL: Record<RunStatus, string> = { running: 'Running', completed: 'Done', failed: 'Failed', missed: 'Missed', skipped: 'Skipped' }

const duration = (run: RoutineRun): string => {
  if (!run.startedAt || !run.endedAt) return ''
  const s = Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000))
  return s < 60 ? `${s}s` : `${Math.round(s / 60)} min`
}

/** What each run did: status, when, how long, why it failed, and its thread. Newest first. */
export function RunLog({ botId }: { botId?: string }) {
  const runs = useRoutines((s) => s.runs)
  const { bots, openBotThread } = useBots()
  const shown = botId ? runs.filter((r) => r.botId === botId) : runs
  if (shown.length === 0) return <EmptyState compact title="No runs yet" description="Each run of a routine is listed here, with how it went." />
  return (
    <ul className={styles.runs} aria-label="Run log">
      {shown.map((run) => (
        <li key={run.id} className={styles.run}>
          <span className={cx(styles.status, styles[run.status])}>{LABEL[run.status]}</span>
          <span className={styles.runText}>
            <span className={styles.routineName}>{run.routineName}</span>
            <span className={styles.meta}>
              {botId ? '' : `${bots.find((b) => b.id === run.botId)?.name ?? 'Deleted bot'} · `}
              {when(run.scheduledFor)}
              {run.trigger === 'manual' ? ' · run by you' : ''}
              {duration(run) ? ` · ${duration(run)}` : ''}
            </span>
            {run.detail && <span className={styles.meta}>{run.detail}</span>}
          </span>
          {run.threadId && bots.some((b) => b.id === run.botId) && (
            <IconButton label={`Open the thread of ${run.routineName}`} icon={<MessageSquare />} onClick={() => void openBotThread(run.botId, run.threadId!)} />
          )}
        </li>
      ))}
    </ul>
  )
}
