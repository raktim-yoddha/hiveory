import { useEffect } from 'react'
import { bindingOf, commandFor, type AppCommandId } from '@shared/keys/keybindings'
import { shortcutLabel, shortcutRecording } from '@shared/keys/shortcut'
import { usePlatform } from '../../lib/platform'
import { useSettings, useWorkspaces } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { runWorkCommand, trackPaneFocus } from '../panes/work-commands'
import { useNewWorktree } from '../workspace-create/new-worktree'
import { usePalette } from './palette/palette-store'
import { focusArea, trackAreaFocus } from './focus-areas'
import { activeTerminalId } from '../terminal/terminal-registry'
import { requestTerminalFind } from '../terminal/terminal-search'

/** A command's keys as the platform writes them ("Ctrl Shift B", "⌘B"), for menus and tooltips; undefined when it has none. */
export function useCommandKeys(id: AppCommandId): string | undefined {
  const keybindings = useSettings((s) => s.settings.keybindings)
  const platform = usePlatform()
  const shortcut = bindingOf(id, keybindings, platform)
  return shortcut ? shortcutLabel(shortcut, platform) : undefined
}

/** The open view, under Settings when it is open over it. */
const workView = () => {
  const { view } = useNavigation.getState()
  return view.type === 'settings' ? view.returnTo : view
}

/** One step through a list, wrapping around; undefined when the list is empty. */
const step = <T,>(list: T[], at: number, by: 1 | -1): T | undefined => (list.length ? list[(Math.max(at, by > 0 ? -1 : 0) + by + list.length) % list.length] : undefined)

/** Next or previous worktree of the open Workspace. */
function moveInList(by: 1 | -1): boolean {
  const nav = useNavigation.getState()
  const view = workView()
  if (view.type !== 'workspace') return false
  const worktrees = useWorkspaces.getState().byProject[view.projectId] ?? []
  const next = step(worktrees, worktrees.findIndex((w) => w.id === view.workspaceId), by)
  if (next && next.id !== view.workspaceId) nav.openWorkspace(view.projectId, next.id)
  return true
}

/** Runs a command; false when it doesn't apply here, so its keys go on to the page (a terminal). */
export function runAppCommand(id: AppCommandId): boolean {
  const nav = useNavigation.getState()
  if (id === 'command-palette') usePalette.getState().toggle()
  else if (id === 'focus-next-area' || id === 'focus-previous-area') return focusArea(id === 'focus-next-area' ? 1 : -1)
  else if (id === 'open-settings') {
    if (nav.view.type === 'settings') nav.closeSettings()
    else nav.openSettings()
  } else if (id === 'show-shortcuts') nav.openSettings('keyboard')
  else if (id === 'toggle-sidebar') nav.toggleSidebar()
  else if (id === 'toggle-side-panel') nav.togglePanel()
  else if (id === 'maximize-side-panel') {
    if (workView().type !== 'workspace') return false
    if (!nav.panelOpen) nav.togglePanel()
    nav.togglePanelMaximized()
  } else if (id === 'open-schedules') nav.openSchedules()
  else if (id === 'new-worktree') {
    const projectId = selectedProjectId(nav.view)
    if (!projectId) return false
    useNewWorktree.getState().open(projectId)
  } else if (id === 'next-item' || id === 'previous-item') return moveInList(id === 'next-item' ? 1 : -1)
  else if (id === 'focus-message') {
    // The message box on screen: the focused agent's chat view, else the first one shown.
    const boxes = [...document.querySelectorAll<HTMLTextAreaElement>('[data-chat-input]')].filter((el) => el.offsetParent !== null)
    const inPane = boxes.find((el) => el.closest('[data-pane-id]')?.contains(document.activeElement))
    const box = inPane ?? boxes[0]
    if (!box) return false
    box.focus()
  } else if (id === 'find-in-terminal') {
    // Only where a terminal is in use; elsewhere the keys go on (⌘F finds in an editor pane).
    const terminal = activeTerminalId()
    return Boolean(terminal) && requestTerminalFind(terminal!)
  } else return runWorkCommand(id)
  return true
}

/**
 * The app's keyboard shortcuts (Settings › Keyboard, ADR 0047). Listens in the capture phase so a
 * focused terminal or editor never swallows them; keys that match nothing pass through untouched.
 */
export function useAppShortcuts(): void {
  const keybindings = useSettings((s) => s.settings.keybindings)
  const platform = usePlatform()
  useEffect(trackPaneFocus, [])
  useEffect(trackAreaFocus, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || e.isComposing || shortcutRecording.active) return
      const id = commandFor(e, keybindings, platform)
      if (!id) return
      // A dialog keeps its keys; only Settings' own shortcut reaches past Settings (to close it).
      const settingsOpen = useNavigation.getState().view.type === 'settings'
      const dialogs = document.querySelectorAll('dialog[open]').length
      if (dialogs > (settingsOpen ? 1 : 0) || (settingsOpen && id !== 'open-settings')) return
      if (!runAppCommand(id)) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [keybindings, platform])
}
