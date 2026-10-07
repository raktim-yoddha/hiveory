import { Pencil, Play } from 'lucide-react'
import type { RoutineView } from '@shared/domain/routine'
import { IconButton } from '../../components/ui/Button'
import { Toggle } from '../../components/ui/Toggle'
import { useRoutines } from '../../stores/routines'
import { useRoutineEditor } from './RoutineEditor'
import { describeSchedule, when } from './routine-text'
import styles from './Routines.module.css'

/** One routine: what it does and when, its next run, on/off, Run now and Edit. */
export function RoutineRow({ routine, botName }: { routine: RoutineView; botName?: string }) {
  const { update, runNow } = useRoutines()
  const open = useRoutineEditor((s) => s.open)
  const next = routine.nextRunAt ? `Next ${when(routine.nextRunAt)}` : routine.enabled ? 'No runs left' : 'Paused'
  return (
    <li className={styles.routineRow}>
      <button type="button" className={styles.routineMain} onClick={() => open({ routineId: routine.id })}>
        <span className={styles.routineName}>{routine.name}</span>
        <span className={styles.meta}>
          {botName ? `${botName} · ` : ''}
          {describeSchedule(routine)} · {next}
        </span>
        {routine.lastRun?.status === 'failed' && <span className={styles.problem}>Last run failed: {routine.lastRun.detail}</span>}
      </button>
      <IconButton label={`Run ${routine.name} now`} icon={<Play />} onClick={() => void runNow(routine.id)} />
      <IconButton label={`Edit ${routine.name}`} icon={<Pencil />} onClick={() => open({ routineId: routine.id })} />
      <Toggle label={`${routine.name} on`} checked={routine.enabled} onChange={(enabled) => void update(routine.id, { enabled })} />
    </li>
  )
}
