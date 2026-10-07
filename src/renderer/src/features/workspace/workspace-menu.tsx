import { CalendarClock, Copy, FolderOpen, Trash2, Wrench, X } from 'lucide-react'
import type { WorkspaceView } from '@shared/domain'
import type { MenuEntry } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'
import { scheduleRoutine } from '../routines/open-run'

/**
 * The one set of Workspace actions, shared by the sidebar's right-click menu and
 * the workspace card. Main is *removed* (forgotten — its folder is the project
 * itself); isolated workspaces are *deleted* with their worktree.
 */
export const workspaceMenuEntries = (workspace: WorkspaceView, onDelete: () => void): MenuEntry[] => [
  {
    type: 'item',
    id: 'reveal',
    label: 'Open folder',
    icon: <FolderOpen />,
    disabled: !workspace.healthy,
    onSelect: () => void runAction('Open folder', () => api('system.revealPath', { workspaceId: workspace.id }))
  },
  {
    type: 'item',
    id: 'copy',
    label: 'Copy path',
    icon: <Copy />,
    onSelect: () => void runAction('Copy path', () => api('clipboard.writeText', { text: workspace.path }))
  },
  {
    type: 'item',
    id: 'schedule',
    label: 'Schedule a routine…',
    icon: <CalendarClock />,
    onSelect: () => scheduleRoutine({ kind: 'workspace', projectId: workspace.projectId, workspaceId: workspace.id, cliId: '' })
  },
  ...(workspace.kind === 'isolated'
    ? [
        {
          type: 'item' as const,
          id: 'repair',
          label: 'Repair folder',
          icon: <Wrench />,
          onSelect: () => void runAction('Repair worktree', () => api('workspaces.repair', { workspaceId: workspace.id }))
        }
      ]
    : []),
  { type: 'separator' },
  workspace.kind === 'main'
    ? { type: 'item', id: 'remove', label: 'Remove worktree', icon: <X />, danger: true, onSelect: onDelete }
    : { type: 'item', id: 'delete', label: 'Delete worktree', icon: <Trash2 />, danger: true, onSelect: onDelete }
]
