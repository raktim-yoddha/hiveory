import { useEffect } from 'react'
import { bindingOf, commandFor, type AppCommandId } from '@shared/keys/keybindings'
import { shortcutLabel } from '@shared/queen/shortcut'
import { usePlatform } from '../../lib/platform'
import { useBots } from '../../stores/bots'
import { useChat } from '../../stores/chat'
import { useSettings, useWorkspaces } from '../../stores/data'
import { selectedProjectId, useNavigation, type AppMode } from '../../stores/navigation'
import { runWorkCommand, trackPaneFocus } from '../panes/work-commands'
import { shortcutRecording } from '../queen/useQueenShortcut'
import { useNewWorktree } from '../workspace-create/new-worktree'

const MODES: Partial<Record<AppCommandId, AppMode>> = { 'mode-work': 'workspace', 'mode-bots': 'bots', 'mode-chat': 'chatspace' }

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

/** Next or previous chat (Chat), bot (Bots) or worktree of the open Workspace (Work). */
function moveInList(by: 1 | -1): boolean {
  const nav = useNavigation.getState()
  if (nav.mode === 'chatspace') {
    const { summaries, activeId, open } = useChat.getState()
    const next = step(summaries, summaries.findIndex((c) => c.id === activeId), by)
    if (next) void open(next.id)
    return true
  }
  if (nav.mode === 'bots') {
    const { bots, activeBotId, select } = useBots.getState()
    const next = step(bots, bots.findIndex((b) => b.id === activeBotId), by)
    if (next) void select(next.id)
    return true
  }
  const view = workView()
  if (view.type !== 'workspace') return false
  const worktrees = useWorkspaces.getState().byProject[view.projectId] ?? []
  const next = step(worktrees, worktrees.findIndex((w) => w.id === view.workspaceId), by)
  if (next && next.id !== view.workspaceId) nav.openWorkspace(view.projectId, next.id)
  return true
}

/** Runs a command; false when it doesn't apply here, so its keys go on to the page (a terminal). */
function run(id: AppCommandId): boolean {
  const nav = useNavigation.getState()
  const mode = MODES[id]
  if (mode) nav.setMode(mode)
  else if (id === 'open-settings') {
    if (nav.view.type === 'settings') nav.closeSettings()
    else nav.openSettings()
  } else if (id === 'show-shortcuts') nav.openSettings('keyboard')
  else if (id === 'toggle-sidebar') nav.toggleSidebar()
  else if (id === 'toggle-side-panel') nav.togglePanel()
  else if (id === 'maximize-side-panel') {
    if (nav.mode !== 'workspace' || workView().type !== 'workspace') return false
    if (!nav.panelOpen) nav.togglePanel()
    nav.togglePanelMaximized()
  } else if (id === 'open-schedules') {
    // Each mode's own Schedules calendar (ADR 0055).
    if (nav.mode === 'chatspace') useChat.getState().showSchedules()
    else if (nav.mode === 'bots') useBots.getState().showRoutines()
    else {
      const view = workView()
      if (view.type !== 'workspace') return false
      nav.ensurePanelTabs(view.workspaceId)
      nav.addPanelTab(view.workspaceId, 'routines')
      if (!nav.panelOpen) nav.togglePanel()
    }
  } else if (id === 'new-item') {
    if (nav.mode === 'chatspace') void useChat.getState().create(selectedProjectId(nav.view))
    else if (nav.mode === 'bots') void import('../bots/BotEditor').then((m) => m.useBotEditor.getState().open('new'))
    else return false
  } else if (id === 'new-worktree') {
    const projectId = nav.mode === 'workspace' ? selectedProjectId(nav.view) : undefined
    if (!projectId) return false
    useNewWorktree.getState().open(projectId)
  } else if (id === 'next-item' || id === 'previous-item') return moveInList(id === 'next-item' ? 1 : -1)
  else if (id === 'focus-message') {
    // The message box on screen: Chat's, a bot thread's, or the focused Work agent's chat view.
    const boxes = [...document.querySelectorAll<HTMLTextAreaElement>('[data-chat-input]')].filter((el) => el.offsetParent !== null)
    const inPane = boxes.find((el) => el.closest('[data-pane-id]')?.contains(document.activeElement))
    const box = inPane ?? boxes[0]
    if (!box) return false
    box.focus()
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || e.isComposing || shortcutRecording.active) return
      const id = commandFor(e, keybindings, platform)
      if (!id) return
      // A dialog keeps its keys; only Settings' own shortcut reaches past Settings (to close it).
      const settingsOpen = useNavigation.getState().view.type === 'settings'
      const dialogs = document.querySelectorAll('dialog[open]').length
      if (dialogs > (settingsOpen ? 1 : 0) || (settingsOpen && id !== 'open-settings')) return
      if (!run(id)) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [keybindings, platform])
}
