/**
 * Splits a path into display segments. A leading home directory
 * (C:\Users\me, /home/me, /Users/me) collapses to a home marker.
 */
export const pathSegments = (path: string): { home: boolean; parts: string[] } => {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  const userIndex = parts.findIndex((p, i) => /^(users|home)$/i.test(p) && i <= 1)
  if (userIndex >= 0 && parts.length > userIndex + 2) return { home: true, parts: parts.slice(userIndex + 2) }
  return { home: false, parts }
}
