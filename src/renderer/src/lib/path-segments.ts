export type PathRoot = 'home' | 'workspaces' | null

/**
 * Splits a path into display segments.
 * - Hiveory-managed workspace folders (…/Hiveory[ Dev]/Workspaces/<project>-<id>/<ws>)
 *   become `workspaces` › project › workspace, without the id suffix.
 * - A leading home directory (C:\Users\me, /home/me, /Users/me) becomes `home`.
 */
export const pathSegments = (path: string): { root: PathRoot; parts: string[] } => {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  const managed = parts.findIndex((p, i) => p === 'Workspaces' && /^hiveory/i.test(parts[i - 1] ?? ''))
  if (managed >= 0 && parts.length > managed + 2) {
    const [project, ...rest] = parts.slice(managed + 1)
    return { root: 'workspaces', parts: [(project as string).replace(/-[0-9a-f]{6}$/i, ''), ...rest] }
  }
  const userIndex = parts.findIndex((p, i) => /^(users|home)$/i.test(p) && i <= 1)
  if (userIndex >= 0 && parts.length > userIndex + 2) return { root: 'home', parts: parts.slice(userIndex + 2) }
  return { root: null, parts }
}
