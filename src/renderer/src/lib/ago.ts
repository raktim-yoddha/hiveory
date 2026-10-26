const MINUTE = 60_000

/** How long ago `ms` (epoch) was, short: "now", "3m", "2h", "4d"; '' when unknown. */
export const shortAgo = (ms: number | undefined, now = Date.now()): string => {
  if (ms === undefined || !Number.isFinite(ms)) return ''
  const minutes = (now - ms) / MINUTE
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${Math.floor(minutes)}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}

/** "3m ago", "2h ago", "4d ago", then a date; "just now" under a minute. */
export const ago = (iso: string, now = Date.now()): string => {
  const ms = Date.parse(iso)
  const short = shortAgo(ms, now)
  if (!short) return ''
  if (short === 'now') return 'just now'
  if (now - ms >= 30 * 24 * 60 * MINUTE) return new Date(iso).toLocaleDateString()
  return `${short} ago`
}

/** How long until `iso`, short: "in 45 min", "in 2 h 13 min", "in 3 d 4 h"; "now" once it has passed. */
export const until = (iso: string, now = Date.now()): string => {
  const minutes = Math.ceil((Date.parse(iso) - now) / MINUTE)
  if (!Number.isFinite(minutes)) return ''
  if (minutes <= 0) return 'now'
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
  return `in ${Math.floor(hours / 24)} d${hours % 24 ? ` ${hours % 24} h` : ''}`
}
