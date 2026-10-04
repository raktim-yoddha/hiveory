import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, GitBranch, House, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import type { Project, WorkspaceView } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { cx } from '../../lib/cx'
import { useWorkspaces } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { CreateWorkspaceDialog } from '../workspace-create/CreateWorkspaceDialog'
import { DeleteWorkspaceDialog } from '../workspace/DeleteWorkspaceDialog'
import styles from './ProjectSidebar.module.css'

const EMPTY: WorkspaceView[] = []

/** A project, its "+ workspace" action and — when expanded — its Workspaces. */
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

  useEffect(() => {
    if (expanded) void loadWorkspaces(project.id)
  }, [expanded, project.id, loadWorkspaces])

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
        <button
          type="button"
          className={styles.rowButton}
          onClick={() => {
            setToggled(null)
            openProject(project.id)
          }}
          title={project.path}
        >
          <span className={styles.rowText}>{project.name}</span>
        </button>
        <IconButton
          className={styles.rowAction}
          label={`New workspace in ${project.name}`}
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
                <button
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
                {ws.kind === 'isolated' && (
                  <Menu
                    label={`${ws.name} actions`}
                    align="end"
                    items={[{ type: 'item', id: 'delete', label: 'Delete workspace', icon: <Trash2 />, danger: true, onSelect: () => setDeleting(ws) }]}
                    trigger={(props) => (
                      <IconButton {...props} className={styles.childAction} label={`${ws.name} actions`} icon={<MoreHorizontal />} />
                    )}
                  />
                )}
              </li>
            )
          })}
          {workspaces.length === 0 && (
            <li>
              <button type="button" className={cx(styles.childRow, styles.ghostRow)} onClick={() => setCreating(true)}>
                <Plus className={styles.childIcon} aria-hidden />
                <span className={styles.rowText}>New workspace</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {creating && <CreateWorkspaceDialog projectId={project.id} onClose={() => setCreating(false)} />}
      {deleting && <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} />}
    </li>
  )
}
