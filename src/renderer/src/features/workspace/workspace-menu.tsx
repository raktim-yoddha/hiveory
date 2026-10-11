import { CalendarClock, Copy, FolderOpen, Trash2, Wrench, X } from 'lucide-react'
import type { WorkspaceView } from '@shared/domain'
import type { MenuEntry } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'
import { scheduleWorkRoutine } from '../routines/open-run'

/**
 * The one set of Workspace actions, shared by the sidebar's right-click menu and
 * the workspace card. Removing the Primary removes the whole Workspace (its folder is the
 * Workspace itself, ADR 0038); other worktrees are *deleted* with their folder.
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
    onSelect: () => scheduleWorkRoutine(workspace.projectId, workspace.id)
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
    ? { type: 'item', id: 'remove', label: 'Remove workspace…', icon: <X />, danger: true, onSelect: onDelete }
    : { type: 'item', id: 'delete', label: 'Delete worktree', icon: <Trash2 />, danger: true, onSelect: onDelete }
]
