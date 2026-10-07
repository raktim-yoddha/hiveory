import type { RoutineRun } from '@shared/domain/routine'

const MAX_BODY = 140

/** The desktop notification for a run that ended or was missed (ADR 0028): the user's own names, on their own screen. */
export function runNotice(run: RoutineRun, botName = 'The bot'): { title: string; body: string } {
  const why = (run.detail ?? '').replace(/\s+/g, ' ').trim()
  const clip = (text: string): string => (text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1)}…` : text)
  if (run.status === 'completed') return { title: `${run.routineName} is done`, body: `${botName} finished this run. Its report is in the thread.` }
  if (run.status === 'missed') return { title: `${run.routineName} was missed`, body: clip(why || 'Hiveory was closed or asleep at that time.') }
  return { title: `${run.routineName} failed`, body: clip(why || `${botName} could not finish this run.`) }
}
