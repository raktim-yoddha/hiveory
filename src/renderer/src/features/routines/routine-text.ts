import type { Routine } from '@shared/domain/routine'

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** This computer's timezone: new routines are scheduled in it. */
export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Whether two zone names are the same clock now, aliases included (Windows says Asia/Calcutta for Asia/Kolkata). */
export function sameZone(a: string, b: string): boolean {
  if (a === b) return true
  try {
    const offset = (zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).format(new Date())
    return offset(a) === offset(b)
  } catch {
    return false
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** "Wed 7 Oct, 23:00" in this computer's time. */
export function when(iso: string): string {
  const d = new Date(iso)
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The weekdays a "selected weekdays" rule runs on. */
export const cronDays = (expr: string): number[] =>
  (expr.trim().split(/\s+/)[4] ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)

/** A routine's schedule in words, e.g. "Weekdays at 09:00". */
export function describeSchedule(r: Pick<Routine, 'schedule' | 'startsAt' | 'timezone'>): string {
  const zone = sameZone(r.timezone, localZone()) ? '' : ` (${r.timezone})`
  const s = r.schedule
  if (s.kind === 'once') return `Once, ${when(r.startsAt)}`
  if (s.kind === 'interval') return `Every ${s.everyMinutes} minutes`
  // Presets write plain numbers into the rule, so it is the source of truth for the time and day.
  const [minute, hour, day, month] = s.expr.trim().split(/\s+/).map(Number)
  const at = ` at ${pad(hour ?? 0)}:${pad(minute ?? 0)}${zone}`
  switch (s.preset) {
    case 'daily':
      return `Daily${at}`
    case 'weekdays':
      return `Weekdays${at}`
    case 'weekly':
    case 'selected-days':
      return `${cronDays(s.expr).map((d) => WEEKDAYS[d]).join(', ')}${at}`
    case 'monthly':
      return `Monthly on day ${day}${at}`
    case 'month-end':
      return `Last day of each month${at}`
    case 'yearly':
      return `Every ${day} ${MONTHS[(month ?? 1) - 1]}${at}`
    case 'custom':
      return `Cron ${s.expr}${zone}`
  }
}
