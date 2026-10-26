import { listPanes, paneGroups } from '@shared/layout/operations'
import type { AppCommandId } from '@shared/keys/keybindings'
import { useClis, useLayouts, useProjects } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { agentActions } from '../agents/agent-actions'
import { focusTerminal } from '../terminal/terminal-registry'
import { closePane, togglePaneMaximized } from './pane-commands'

/** The pane the keyboard was last in (a terminal, a chat box, a file); kept while focus is elsewhere. */
let lastPane: string | null = null

/** Follows focus into panes (their slots carry `data-pane-id`). Returns the stop function. */
export const trackPaneFocus = (): (() => void) => {
  const onFocus = (event: FocusEvent): void => {
    const id = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-pane-id]')?.dataset.paneId
    if (id) lastPane = id
  }
  document.addEventListener('focusin', onFocus)
  return () => document.removeEventListener('focusin', onFocus)
}

/** Puts the keyboard in a pane: its terminal, else its message box, else the pane itself. */
const focusPane = (paneId: string): void => {
  lastPane = paneId
  // The pane may only now be shown (a tab chosen): focus once it has painted.
  requestAnimationFrame(() => {
    focusTerminal(paneId)
    const slot = document.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(paneId)}"]`)
    if (slot && !slot.contains(document.activeElement)) slot.querySelector<HTMLElement>('[data-chat-input], .cm-content')?.focus()
  })
}

/**
 * The panes-and-tabs shortcuts (ADR 0042, 0047) for the open worktree. False when none applies here
 * (another mode, Home, an empty worktree), so the keys go on to the page.
 */
export function runWorkCommand(id: AppCommandId): boolean {
  const nav = useNavigation.getState()
  const view = nav.view.type === 'settings' ? nav.view.returnTo : nav.view
  if (nav.mode !== 'workspace' || view.type !== 'workspace') return false
  const { projectId, workspaceId } = view
  const tree = useLayouts.getState().byWorkspace[workspaceId] ?? null
  const panes = listPanes(tree)
  const groups = paneGroups(tree)
  const apply = (operation: Parameters<ReturnType<typeof useLayouts.getState>['apply']>[1]): void => void useLayouts.getState().apply(workspaceId, operation)
  const current = lastPane && panes.includes(lastPane) ? lastPane : panes[0]
  // The tab shown in the current pane's area.
  const shown = current ? (groups[current]?.active ?? current) : undefined

  if (id === 'new-terminal') {
    // A terminal of the machine the Workspace lives on (remote Workspaces list their own).
    const remote = Boolean(useProjects.getState().projects.find((p) => p.id === projectId)?.host)
    const clis = remote ? (useClis.getState().remote[projectId] ?? []) : useClis.getState().clis
    const shell = clis.find((c) => c.kind === 'shell' && c.available)
    if (!shell) return false
    void agentActions.open(workspaceId, shell.id, shown ? { targetPaneId: shown, side: 'right', asTab: true } : undefined, undefined, false)
    return true
  }
  if (!shown) return false
  const area = groups[shown]?.paneIds ?? [shown]
  const areas = [...new Map(panes.map((p) => [groups[p]?.active ?? p, true])).keys()]

  switch (id) {
    case 'new-tab':
      // The area's own "+": the same picker, opened from the keyboard.
      document.querySelector<HTMLButtonElement>(`[data-pane-id="${CSS.escape(shown)}"] button[aria-label="Add agent"]`)?.click()
      return true
    case 'close-tab':
      closePane(shown)
      return true
    case 'next-tab':
    case 'previous-tab': {
      if (area.length < 2) return true
      const next = area[(area.indexOf(shown) + (id === 'next-tab' ? 1 : area.length - 1)) % area.length]!
      apply({ type: 'activate', paneId: next })
      focusPane(next)
      return true
    }
    case 'next-pane':
    case 'previous-pane': {
      if (areas.length < 2) return true
      const next = areas[(areas.indexOf(shown) + (id === 'next-pane' ? 1 : areas.length - 1)) % areas.length]!
      focusPane(next)
      return true
    }
    case 'maximize-pane':
      togglePaneMaximized(shown)
      return true
    case 'split-right':
    case 'split-down': {
      // Like the tab's own Split right / Split down: only a tab with company can leave its area.
      const sibling = area.find((p) => p !== shown)
      if (sibling) apply({ type: 'move', paneId: shown, targetPaneId: sibling, side: id === 'split-right' ? 'right' : 'bottom' })
      return true
    }
    default:
      return false
  }
}
