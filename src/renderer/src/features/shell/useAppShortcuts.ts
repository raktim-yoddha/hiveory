import { useEffect } from 'react'
import { bindingOf, commandFor, type AppCommandId } from '@shared/keys/keybindings'
import { shortcutLabel } from '@shared/queen/shortcut'
import { usePlatform } from '../../lib/platform'
import { useChat } from '../../stores/chat'
import { useSettings } from '../../stores/data'
import { selectedProjectId, useNavigation, type AppMode } from '../../stores/navigation'
import { shortcutRecording } from '../queen/useQueenShortcut'

const MODES: Partial<Record<AppCommandId, AppMode>> = { 'mode-work': 'workspace', 'mode-bots': 'bots', 'mode-chat': 'chatspace' }

/** A command's keys as the platform writes them ("Ctrl Shift B", "⌘B"), for menus and tooltips; undefined when it has none. */
export function useCommandKeys(id: AppCommandId): string | undefined {
  const keybindings = useSettings((s) => s.settings.keybindings)
  const platform = usePlatform()
  const shortcut = bindingOf(id, keybindings, platform)
  return shortcut ? shortcutLabel(shortcut, platform) : undefined
}

/** Runs a command; false when it doesn't apply here, so its keys go on to the page (a terminal). */
function run(id: AppCommandId): boolean {
  const nav = useNavigation.getState()
  const mode = MODES[id]
  if (mode) nav.setMode(mode)
  else if (id === 'open-settings') {
    if (nav.view.type === 'settings') nav.closeSettings()
    else nav.openSettings()
  } else if (id === 'toggle-sidebar') nav.toggleSidebar()
  else if (id === 'toggle-side-panel') nav.togglePanel()
  else if (id === 'new-item') {
    if (nav.mode === 'chatspace') void useChat.getState().create(selectedProjectId(nav.view))
    else if (nav.mode === 'bots') void import('../bots/BotEditor').then((m) => m.useBotEditor.getState().open('new'))
    else return false
  }
  return true
}

/**
 * The app's keyboard shortcuts (Settings › Keyboard, ADR 0047). Listens in the capture phase so a
 * focused terminal or editor never swallows them; keys that match nothing pass through untouched.
 */
export function useAppShortcuts(): void {
  const keybindings = useSettings((s) => s.settings.keybindings)
  const platform = usePlatform()
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
