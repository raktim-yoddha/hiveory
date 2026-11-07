import type { RoutineRun } from '@shared/domain/routine'

const MAX_BODY = 140

/** The desktop notification for a run that ended or was missed (ADR 0028): the user's own names, on their own screen. */
export function runNotice(run: RoutineRun): { title: string; body: string } {
  const why = (run.detail ?? '').replace(/\s+/g, ' ').trim()
  const who = run.where ?? 'The agent'
  const clip = (text: string): string => (text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1)}…` : text)
  if (run.status === 'completed') return { title: `${run.routineName} is done`, body: clip(`${who} finished this run.`) }
  if (run.status === 'missed') return { title: `${run.routineName} was missed`, body: clip(why || 'Hiveory was closed or asleep at that time.') }
  return { title: `${run.routineName} failed`, body: clip(why || `${who} could not finish this run.`) }
}
