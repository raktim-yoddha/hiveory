import { useState } from 'react'
import { GitBranch, House, MoreHorizontal } from 'lucide-react'
import type { Project, WorkspaceView } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { DeleteWorkspaceDialog } from '../workspace/DeleteWorkspaceDialog'
import { workspaceMenuEntries } from '../workspace/workspace-menu'
import { GitActionButton } from './GitActionButton'
import { OpenInButton } from './OpenInButton'
import { RunButton } from './RunButton'
import styles from './WorktreeBar.module.css'
import { folderName } from '../../lib/folder-name'

/**
 * The worktree's top bar (ADR 0064): its name, Workspace and branch with its actions (⋯), then Run ▾,
 * Open in ▾ and the git button with the worktree's next step. Its empty space drags the window.
 */
export function WorktreeBar({ project, workspace }: { project: Project; workspace: WorkspaceView }) {
  const [deleting, setDeleting] = useState(false)
  const primary = workspace.kind === 'main'
  const remote = Boolean(project.host)
  const title = primary ? folderName(project.path) : workspace.name
  return (
    <header className={styles.bar} data-top-bar aria-label="Worktree">
      <span className={styles.title}>
        {primary ? <House aria-hidden className={styles.icon} /> : <GitBranch aria-hidden className={styles.icon} />}
        <span className={styles.name}>{title}</span>
        {project.name !== title && <span className={styles.project}>{project.name}</span>}
        {workspace.git?.branch && <span className={styles.branch}>{workspace.git.branch}</span>}
      </span>
      <Menu label={`${workspace.name} actions`} items={workspaceMenuEntries(workspace, () => setDeleting(true))} trigger={(props) => <IconButton {...props} label={`${workspace.name} actions`} icon={<MoreHorizontal />} className={styles.noDrag} />} />
      <span className={styles.flex} />
      <span className={styles.actions}>
        <RunButton project={project} workspaceId={workspace.id} />
        {!remote && <OpenInButton workspace={workspace} />}
        {!remote && workspace.git && <GitActionButton workspace={workspace} />}
      </span>
      {deleting && <DeleteWorkspaceDialog workspace={workspace} onClose={() => setDeleting(false)} />}
    </header>
  )
}
