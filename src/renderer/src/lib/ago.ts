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
