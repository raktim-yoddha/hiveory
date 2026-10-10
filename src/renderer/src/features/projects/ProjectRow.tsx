import { useEffect, useState } from 'react'
import { AlertTriangle, Copy, FolderOpen, GitBranch, House, Plus, Settings2, X } from 'lucide-react'
import type { Project, WorkspaceView } from '@shared/domain'
import { HostBadge } from '../../components/ui/HostBadge'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useWorkspaces } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { NewWorktreeMenu } from '../workspace-create/NewWorktreeMenu'
import { DeleteWorkspaceDialog } from '../workspace/DeleteWorkspaceDialog'
import { workspaceMenuEntries } from '../workspace/workspace-menu'
import { RemoveProjectDialog } from './RemoveProjectDialog'
import { WorkspaceMark } from './WorkspaceMark'
import styles from './ProjectSidebar.module.css'

const EMPTY: WorkspaceView[] = []

/** Last part of a path, on any platform. */
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/**
 * A Workspace and its Worktrees (ADR 0038). Its mark folds the Worktrees; the row itself only
 * acts while folded, opening the Worktree last used here, and then shows that Worktree's folder
 * and branch. Right-click either for actions.
 */
export function ProjectRow({ project }: { project: Project }) {
  const view = useNavigation((s) => s.view)
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const openProject = useNavigation((s) => s.openProject)
  const lastId = useNavigation((s) => s.lastWorktree[project.id])
  const workspaces = useWorkspaces((s) => s.byProject[project.id] ?? EMPTY)
  const loadWorkspaces = useWorkspaces((s) => s.load)
  const isCurrent = selectedProjectId(view) === project.id
  // Follows the selection until the user folds or unfolds it.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const expanded = toggled ?? isCurrent
  const [deleting, setDeleting] = useState<WorkspaceView | null>(null)
  const [removing, setRemoving] = useState(false)
  const primary = workspaces.find((w) => w.kind === 'main')
  const missing = primary ? !primary.healthy : false
  const target = workspaces.find((w) => w.id === lastId) ?? primary ?? workspaces[0]

  useEffect(() => {
    void loadWorkspaces(project.id)
  }, [project.id, loadWorkspaces])

  const openTarget = (): void => {
    if (!expanded && target) openWorkspace(project.id, target.id)
  }

  return (
    <li>
      <div className={cx(styles.row, !expanded && styles.folded, !expanded && isCurrent && styles.selected, missing && styles.missing)}>
        <button
          type="button"
          className={styles.mark}
          aria-label={expanded ? `Fold ${project.name}` : `Unfold ${project.name}`}
          aria-expanded={expanded}
          title={missing ? 'Folder missing on disk' : expanded ? 'Fold worktrees' : 'Show worktrees'}
          onClick={() => setToggled(!expanded)}
        >
          {missing ? <AlertTriangle className={cx(styles.markIcon, styles.warn)} aria-hidden /> : <WorkspaceMark project={project} className={styles.markIcon} />}
        </button>
        <Menu
          context
          label={`${project.name} actions`}
          items={[
            {
              type: 'item',
              id: 'settings',
              label: 'Workspace settings',
              icon: <Settings2 />,
              disabled: !target,
              onSelect: () => openProject(project.id, 'settings')
            },
            { type: 'separator' },
            {
              type: 'item',
              id: 'reveal',
              label: 'Open folder',
              icon: <FolderOpen />,
              disabled: missing,
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
            <button
              {...props}
              type="button"
              className={styles.rowButton}
              onClick={openTarget}
              aria-label={expanded ? project.name : `${project.name}: open ${target?.name ?? 'its worktree'}`}
              title={missing ? `${project.path} — folder missing` : project.path}
            >
              <span className={styles.rowLines}>
                <span className={styles.rowTitle}>
                  <span className={styles.rowText}>{project.name}</span>
                  <HostBadge host={project.host} iconOnly />
                </span>
                {!expanded && target && (
                  <span className={styles.rowMeta}>
                    <span className={styles.metaPath}>../{folderName(target.path)}</span>
                    {target.git?.branch && (
                      <span className={styles.metaBranch}>
                        <GitBranch aria-hidden />
                        <span className={styles.rowText}>{target.git.branch}</span>
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          )}
        />
        <NewWorktreeMenu
          projectId={project.id}
          trigger={(props) => <IconButton {...props} className={styles.rowAction} label={`New worktree in ${project.name}`} icon={<Plus />} />}
        />
      </div>
      {expanded && (
        <ul className={styles.children}>
          {workspaces.map((ws) => {
            const selected = view.type === 'workspace' && view.workspaceId === ws.id
            const main = ws.kind === 'main'
            const Icon = main ? House : GitBranch
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
                      aria-label={main ? `${folderName(project.path)}, primary worktree` : ws.name}
                      title={ws.healthy ? ws.path : 'Folder missing on disk'}
                    >
                      {ws.healthy ? (
                        <Icon className={styles.childIcon} aria-hidden />
                      ) : (
                        <AlertTriangle className={cx(styles.childIcon, styles.warn)} aria-label="Folder missing" />
                      )}
                      <span className={styles.rowLines}>
                        <span className={styles.rowTitle}>
                          {/* The Primary is the Workspace's own folder: it shows the folder's name and a tag (ADR 0038). */}
                          <span className={styles.rowText}>{main ? folderName(project.path) : ws.name}</span>
                          {main && <span className={styles.tag}>Primary</span>}
                        </span>
                        {ws.git?.branch && <span className={cx(styles.rowMeta, styles.rowText)}>{ws.git.branch}</span>}
                      </span>
                      {ws.agentCount > 0 && <span className={styles.count}>{ws.agentCount}</span>}
                    </button>
                  )}
                />
              </li>
            )
          })}
        </ul>
      )}
      {deleting && <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} />}
      {removing && <RemoveProjectDialog project={project} onClose={() => setRemoving(false)} />}
    </li>
  )
}
