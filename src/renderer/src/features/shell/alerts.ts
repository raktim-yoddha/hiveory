import type { AgentUpdate } from '@shared/domain'
export { alertWanted } from '@shared/domain'

const minutes = (seconds?: number): string => (seconds && seconds >= 60 ? ` · worked ${Math.round(seconds / 60)} min` : '')

/** A notification's words: who, and where. Text only; the OS shows it as given. */
export const alertText = (u: AgentUpdate): { title: string; body: string } => {
  const where = `${u.cliName} · ${u.workspaceName}`
  const said = u.excerpt ? `\n${u.excerpt.replace(/\s+/g, ' ').slice(0, 140)}` : ''
  if (u.kind === 'waiting') return { title: `${u.petName} needs you`, body: `${where}${u.reason ? ` — ${u.reason}` : ''}${said}`.slice(0, 300) }
  if (u.kind === 'finished') return { title: `${u.petName} finished`, body: `${where}${minutes(u.workedSeconds)}${said}`.slice(0, 300) }
  return { title: `${u.petName} stopped`, body: `${where}${u.reason ? ` — ${u.reason}` : ''}`.slice(0, 300) }
}
