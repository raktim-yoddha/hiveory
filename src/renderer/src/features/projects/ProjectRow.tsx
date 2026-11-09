import { useEffect, useState } from 'react'
import { AlertTriangle, Copy, FolderOpen, GitBranch, House, Pin, PinOff, Settings2, X } from 'lucide-react'
import type { Project, WorkspaceView } from '@shared/domain'
import { HostBadge } from '../../components/ui/HostBadge'
import { Menu } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useProjects, useWorkspaces } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { NewWorktreeButton } from '../workspace-create/NewWorktreeButton'
import { DeleteWorkspaceDialog } from '../workspace/DeleteWorkspaceDialog'
import { workspaceMenuEntries } from '../workspace/workspace-menu'
import { RemoveProjectDialog } from './RemoveProjectDialog'
import { WorkspaceMark } from './WorkspaceMark'
import { lastWorktreeOf } from './project-list'
import { WorktreeAgents, WorktreeBusy } from './WorktreeAgents'
import styles from './ProjectSidebar.module.css'
import { folderName } from '../../lib/folder-name'

const EMPTY: WorkspaceView[] = []

/**
 * A Workspace and its Worktrees (ADR 0038). Its mark folds the Worktrees; the row itself only
 * acts while folded, opening the Worktree last used here, and then shows that Worktree's folder
 * and branch. Right-click either for actions.
 */
export function ProjectRow({ project }: { project: Project }) {
  const view = useNavigation((s) => s.view)
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const openSettings = useNavigation((s) => s.openSettings)
  const lastId = useNavigation((s) => s.lastWorktree[project.id])
  const workspaces = useWorkspaces((s) => s.byProject[project.id] ?? EMPTY)
  const loadWorkspaces = useWorkspaces((s) => s.ensure)
  const isCurrent = selectedProjectId(view) === project.id
  // Follows the selection until the user folds or unfolds it.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const expanded = toggled ?? isCurrent
  const [deleting, setDeleting] = useState<WorkspaceView | null>(null)
  const [removing, setRemoving] = useState(false)
  const primary = workspaces.find((w) => w.kind === 'main')
  const missing = primary ? !primary.healthy : false
  const target = lastWorktreeOf(workspaces, lastId)

  useEffect(() => {
    void loadWorkspaces(project.id)
  }, [project.id, loadWorkspaces])

  const openTarget = (): void => {
    if (!expanded && target) openWorkspace(target.projectId, target.id)
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
              // Settings, on this Workspace's page (ADR 0062).
              onSelect: () => openSettings('workspace', project.id)
            },
            {
              type: 'item',
              id: 'pin',
              label: project.settings?.pinned ? 'Unpin' : 'Pin to top',
              icon: project.settings?.pinned ? <PinOff /> : <Pin />,
              onSelect: () => void useProjects.getState().update(project.id, { settings: { pinned: project.settings?.pinned ? null : true } })
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
                    {/* The Primary is the Workspace's own folder: its name would only repeat the title (ADR 0039). */}
                    {target.kind !== 'main' && <span className={styles.metaPath}>{target.name}</span>}
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
        <NewWorktreeButton projectId={project.id} className={styles.rowAction} label={`New worktree in ${project.name}`} />
      </div>
      {expanded && (
        <ul className={styles.children}>
          {workspaces.map((ws) => {
            const selected = view.type === 'workspace' && view.workspaceId === ws.id
            const main = ws.kind === 'main'
            const Icon = main ? House : GitBranch
            return (
              <li key={ws.id} className={cx(styles.childItem, selected && styles.current)}>
                <Menu
                  context
                  label={`${ws.name} actions`}
                  items={workspaceMenuEntries(ws, () => setDeleting(ws))}
                  trigger={(props) => (
                    <button
                      {...props}
                      type="button"
                      className={cx(styles.childRow, selected && styles.selected)}
                      onClick={() => openWorkspace(ws.projectId, ws.id)}
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
                          {/* The Primary is the Workspace's own folder: its name, then the tag right beside it (ADR 0038, 0039). */}
                          <span className={styles.rowName}>{main ? folderName(project.path) : ws.name}</span>
                          {main && <span className={styles.tag}>Primary</span>}
                        </span>
                        {ws.git?.branch && <span className={cx(styles.rowMeta, styles.rowText)}>{ws.git.branch}</span>}
                      </span>
                      <WorktreeBusy workspaceId={ws.id} />
                    </button>
                  )}
                />
                <WorktreeAgents projectId={ws.projectId} workspaceId={ws.id} />
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
