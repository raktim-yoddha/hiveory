import { useEffect, useState } from 'react'
import { HostBadge } from '../../components/ui/HostBadge'
import { AlertTriangle, ChevronRight, Copy, FolderOpen, GitBranch, House, LayoutGrid, Plus, X } from 'lucide-react'
import type { Project, WorkspaceView } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useWorkspaces } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { CreateWorkspaceDialog } from '../workspace-create/CreateWorkspaceDialog'
import { DeleteWorkspaceDialog } from '../workspace/DeleteWorkspaceDialog'
import { workspaceMenuEntries } from '../workspace/workspace-menu'
import { RemoveProjectDialog } from './RemoveProjectDialog'
import styles from './ProjectSidebar.module.css'

const EMPTY: WorkspaceView[] = []

/** A project, its "+ workspace" action and — when expanded — its Workspaces. Right-click either for actions. */
export function ProjectRow({ project }: { project: Project }) {
  const view = useNavigation((s) => s.view)
  const { openProject, openWorkspace } = useNavigation()
  const workspaces = useWorkspaces((s) => s.byProject[project.id] ?? EMPTY)
  const loadWorkspaces = useWorkspaces((s) => s.load)
  const isCurrent = selectedProjectId(view) === project.id
  // Follows the selection until the user toggles it explicitly.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const expanded = toggled ?? isCurrent
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<WorkspaceView | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (expanded) void loadWorkspaces(project.id)
  }, [expanded, project.id, loadWorkspaces])

  const open = (): void => {
    setToggled(null)
    openProject(project.id)
  }

  return (
    <li>
      <div className={cx(styles.row, isCurrent && view.type === 'project' && styles.selected)}>
        <button
          type="button"
          className={styles.chevron}
          aria-label={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
          aria-expanded={expanded}
          onClick={() => setToggled(!expanded)}
        >
          <ChevronRight className={cx(styles.chevronIcon, expanded && styles.open)} />
        </button>
        <Menu
          context
          label={`${project.name} actions`}
          items={[
            { type: 'item', id: 'open', label: 'Open workspace', icon: <LayoutGrid />, onSelect: open },
            { type: 'item', id: 'new', label: 'New worktree…', icon: <Plus />, onSelect: () => setCreating(true) },
            { type: 'separator' },
            {
              type: 'item',
              id: 'reveal',
              label: 'Open folder',
              icon: <FolderOpen />,
              onSelect: () => void runAction('Open folder', () => api('system.revealPath', { projectId: project.id }))
            },
            {
              type: 'item',
              id: 'copy',
              label: 'Copy path',
              icon: <Copy />,
              onSelect: () => void runAction('Copy path', () => api('clipboard.writeText', { text: project.path }))
            },
            { type: 'separator' },
            { type: 'item', id: 'remove', label: 'Remove workspace…', icon: <X />, danger: true, onSelect: () => setRemoving(true) }
          ]}
          trigger={(props) => (
            <button {...props} type="button" className={styles.rowButton} onClick={open} title={project.path}>
              <span className={styles.rowText}>{project.name}</span>
              <HostBadge host={project.host} iconOnly />
            </button>
          )}
        />
        <IconButton
          className={styles.rowAction}
          label={`New worktree in ${project.name}`}
          icon={<Plus />}
          onClick={() => setCreating(true)}
        />
      </div>
      {expanded && (
        <ul className={styles.children}>
          {workspaces.map((ws) => {
            const selected = view.type === 'workspace' && view.workspaceId === ws.id
            const Icon = ws.kind === 'main' ? House : GitBranch
            return (
              <li key={ws.id} className={styles.childItem}>
                <Menu
                  context
                  label={`${ws.name} actions`}
                  items={workspaceMenuEntries(ws, () => setDeleting(ws))}
                  trigger={(props) => (
                    <button
                      {...props}
                      type="button"
                      className={cx(styles.childRow, selected && styles.selected)}
                      onClick={() => openWorkspace(project.id, ws.id)}
                      aria-current={selected ? 'page' : undefined}
                      title={ws.healthy ? ws.path : 'Folder missing on disk'}
                    >
                      {ws.healthy ? (
                        <Icon className={styles.childIcon} aria-hidden />
                      ) : (
                        <AlertTriangle className={cx(styles.childIcon, styles.warn)} aria-label="Folder missing" />
                      )}
                      <span className={styles.rowText}>{ws.name}</span>
                      {ws.agentCount > 0 && <span className={styles.count}>{ws.agentCount}</span>}
                    </button>
                  )}
                />
              </li>
            )
          })}
          {workspaces.length === 0 && (
            <li>
              <button type="button" className={cx(styles.childRow, styles.ghostRow)} onClick={() => setCreating(true)}>
                <Plus className={styles.childIcon} aria-hidden />
                <span className={styles.rowText}>New worktree</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {creating && <CreateWorkspaceDialog projectId={project.id} onClose={() => setCreating(false)} />}
      {deleting && <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} />}
      {removing && <RemoveProjectDialog project={project} onClose={() => setRemoving(false)} />}
    </li>
  )
}
