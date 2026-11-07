import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { Project, WorkspaceView } from '@shared/domain'
import { cx } from '../../lib/cx'
import { useProjects, useWorkspaces } from '../../stores/data'
import { selectedProjectId, selectedWorkspaceId, useNavigation } from '../../stores/navigation'
import { WorkspaceMark } from './WorkspaceMark'
import { lastWorktreeOf, readSort, sortProjects, worktreeInitials, worktreeLabel } from './project-list'
import styles from './RailWorkspaces.module.css'

const EMPTY: WorkspaceView[] = []

/**
 * The folded sidebar's Workspaces (ADR 0056): one mark each, in the sidebar's order. A click opens
 * the Worktree last used there; a double-click (or →) lists its Worktrees by their initials.
 */
export function RailWorkspaces() {
  const { projects, loaded, load } = useProjects()
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])
  const sorted = useMemo(() => sortProjects(projects, readSort()), [projects])
  if (sorted.length === 0) return <span className={styles.spacer} />
  return (
    <ul className={styles.list} aria-label="Workspaces">
      {sorted.map((project) => (
        <RailWorkspace key={project.id} project={project} />
      ))}
    </ul>
  )
}

function RailWorkspace({ project }: { project: Project }) {
  const view = useNavigation((s) => s.view)
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const lastId = useNavigation((s) => s.lastWorktree[project.id])
  const worktrees = useWorkspaces((s) => s.byProject[project.id] ?? EMPTY)
  const loadWorktrees = useWorkspaces((s) => s.load)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void loadWorktrees(project.id)
  }, [project.id, loadWorktrees])

  const target = lastWorktreeOf(worktrees, lastId)
  const current = selectedProjectId(view) === project.id
  const currentWorktree = selectedWorkspaceId(view)
  const go = (w?: WorkspaceView): void => {
    if (w) openWorkspace(w.projectId, w.id)
  }
  // The keyboard's double-click: → lists the Worktrees, ← folds them.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setOpen(event.key === 'ArrowRight')
    }
  }

  return (
    <li className={cx(styles.item, open && styles.open)}>
      <button
        type="button"
        className={cx(styles.workspace, current && styles.current)}
        aria-label={target ? `${project.name}: open ${worktreeLabel(target)}` : project.name}
        aria-expanded={open}
        title={`${project.name}${target ? ` · ${worktreeLabel(target)}` : ''}\nDouble-click for its worktrees`}
        // Both clicks of a double-click open the same Worktree first, so the list never fights them.
        onClick={() => go(target)}
        onDoubleClick={() => setOpen(!open)}
        onKeyDown={onKey}
      >
        <WorkspaceMark project={project} className={styles.mark} />
      </button>
      {open && (
        <ul className={styles.worktrees} aria-label={`${project.name} worktrees`}>
          {worktrees.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                className={cx(styles.worktree, w.id === currentWorktree && styles.current)}
                aria-label={`Open ${worktreeLabel(w)}`}
                aria-current={w.id === currentWorktree ? 'page' : undefined}
                title={worktreeLabel(w)}
                onClick={() => go(w)}
              >
                {worktreeInitials(w)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
