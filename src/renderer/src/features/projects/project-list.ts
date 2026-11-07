import { PRIMARY_NAME, type Project, type ProjectSort, type WorkspaceView } from '@shared/domain'

/** The sidebar's sort, kept per computer; the rail follows it (ADR 0056). */
const SORT_KEY = 'hiveory.projectSort'

export const readSort = (): ProjectSort => {
  try {
    return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'recent'
  } catch {
    return 'recent'
  }
}

export const saveSort = (sort: ProjectSort): void => {
  try {
    localStorage.setItem(SORT_KEY, sort)
  } catch {
    // Sorting still works for this session without storage.
  }
}

/** Recent = last real work (ADR 0024): opening a Workspace does not move it. */
export const sortProjects = (projects: Project[], sort: ProjectSort): Project[] =>
  [...projects].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) : (b.lastActiveAt ?? b.createdAt).localeCompare(a.lastActiveAt ?? a.createdAt)
  )

/** The Worktree a Workspace opens on: the one last used there, else Primary, else the first. */
export const lastWorktreeOf = (worktrees: WorkspaceView[], lastId?: string): WorkspaceView | undefined =>
  worktrees.find((w) => w.id === lastId) ?? worktrees.find((w) => w.kind === 'main') ?? worktrees[0]

/** "Primary · main", "login-page · feature/login-page": what a Worktree's tooltip and label say. */
export const worktreeLabel = (w: Pick<WorkspaceView, 'kind' | 'name' | 'git'>): string => {
  const name = w.kind === 'main' ? PRIMARY_NAME : w.name
  const branch = w.git?.branch
  return branch && branch !== name ? `${name} · ${branch}` : name
}

/**
 * A Worktree's two-letter mark in the rail, from its branch (else its name): the first letters of
 * its first two words ("feature/login-page" → "LP"), or the first two letters of one word ("main" → "MA").
 */
export const worktreeInitials = (w: Pick<WorkspaceView, 'name' | 'git'>): string => {
  const source = (w.git?.branch ?? w.name).split('/').filter(Boolean).at(-1) ?? ''
  const words = source.split(/[-_.\s]+/).filter(Boolean)
  const [first = '', second] = words
  const letters = second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)
  return letters.toUpperCase() || '?'
}
