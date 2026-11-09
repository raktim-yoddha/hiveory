import { formatShortcut, parseShortcut, type Modifier, type Shortcut } from './shortcut'

/**
 * The app's keyboard shortcuts (ADR 0047), each with the standard keys of its platform: ⌘ on macOS;
 * Ctrl on Windows and Linux, never the Windows/Super key (the system owns it). Where Ctrl + a letter
 * would take a key terminal CLIs use (Ctrl B, Ctrl J…), Windows and Linux add Shift, the way
 * terminal apps do. The user can change or clear any of them in Settings › Keyboard.
 */
export const APP_COMMANDS = [
  // Everything below, and every Workspace, worktree, agent and Settings page, searchable (ADR 0060).
  { id: 'command-palette', label: 'Find a command, worktree or setting', group: 'General', mac: 'Meta+KeyK', other: 'Control+Shift+KeyP' },
  { id: 'open-settings', label: 'Open or close Settings', group: 'General', mac: 'Meta+Comma', other: 'Control+Comma' },
  // Between the sidebar, the worktree and the side panel, as F6 does in native apps (ADR 0061).
  { id: 'focus-next-area', label: 'Move to the next area', group: 'General', mac: 'Meta+F6', other: 'Control+F6' },
  { id: 'focus-previous-area', label: 'Move to the previous area', group: 'General', mac: 'Meta+Shift+F6', other: 'Control+Shift+F6' },
  { id: 'show-shortcuts', label: 'Show keyboard shortcuts', group: 'General', mac: 'Meta+Slash', other: 'Control+Shift+Slash' },
  { id: 'toggle-sidebar', label: 'Show or hide the sidebar', group: 'General', mac: 'Meta+KeyB', other: 'Control+Shift+KeyB' },
  { id: 'toggle-side-panel', label: 'Show or hide the side panel', group: 'General', mac: 'Meta+KeyJ', other: 'Control+Shift+KeyJ' },
  { id: 'maximize-side-panel', label: 'Maximize or restore the side panel', group: 'General', mac: 'Meta+Shift+KeyM', other: 'Control+Shift+KeyM' },
  { id: 'open-schedules', label: 'Open Schedules', group: 'General', mac: 'Meta+Shift+KeyS', other: 'Control+Shift+KeyS' },
  { id: 'new-worktree', label: 'New worktree in this workspace', group: 'Lists', mac: 'Meta+Shift+KeyN', other: 'Control+Shift+KeyN' },
  { id: 'next-item', label: 'Next worktree', group: 'Lists', mac: 'Meta+Alt+ArrowDown', other: 'Alt+ArrowDown' },
  { id: 'previous-item', label: 'Previous worktree', group: 'Lists', mac: 'Meta+Alt+ArrowUp', other: 'Alt+ArrowUp' },
  // Panes and tabs of the open worktree (ADR 0042); elsewhere the keys pass through.
  { id: 'new-tab', label: 'New tab: pick an agent, terminal or browser', group: 'Panes and tabs', mac: 'Meta+KeyT', other: 'Control+Shift+KeyT' },
  { id: 'new-terminal', label: 'New terminal tab', group: 'Panes and tabs', mac: 'Meta+Alt+KeyT', other: 'Control+Shift+Backquote' },
  { id: 'close-tab', label: 'Close the tab', group: 'Panes and tabs', mac: 'Meta+Shift+KeyW', other: 'Control+Shift+KeyW' },
  { id: 'next-tab', label: 'Next tab in the area', group: 'Panes and tabs', mac: 'Meta+Shift+BracketRight', other: 'Control+Tab' },
  { id: 'previous-tab', label: 'Previous tab in the area', group: 'Panes and tabs', mac: 'Meta+Shift+BracketLeft', other: 'Control+Shift+Tab' },
  { id: 'next-pane', label: 'Next area', group: 'Panes and tabs', mac: 'Meta+Alt+ArrowRight', other: 'Control+Alt+ArrowRight' },
  { id: 'previous-pane', label: 'Previous area', group: 'Panes and tabs', mac: 'Meta+Alt+ArrowLeft', other: 'Control+Alt+ArrowLeft' },
  { id: 'maximize-pane', label: 'Maximize or restore the pane', group: 'Panes and tabs', mac: 'Meta+Shift+Enter', other: 'Control+Shift+Enter' },
  { id: 'split-right', label: 'Split the tab out to the right', group: 'Panes and tabs', mac: 'Meta+KeyD', other: 'Alt+Shift+Equal' },
  { id: 'split-down', label: 'Split the tab out below', group: 'Panes and tabs', mac: 'Meta+Shift+KeyD', other: 'Alt+Shift+Minus' },
  { id: 'focus-message', label: 'Type in the message box', group: 'Chat', mac: 'Meta+KeyL', other: 'Control+Shift+KeyL' }
] as const satisfies ReadonlyArray<{ id: string; label: string; group: string; mac: string; other: string }>

export type AppCommandId = (typeof APP_COMMANDS)[number]['id']

/** The user's changes: a shortcut per command, or '' for none. Commands left out keep their default. */
export type Keybindings = Partial<Record<AppCommandId, string>>

export const isAppCommand = (id: string): id is AppCommandId => APP_COMMANDS.some((c) => c.id === id)

export const defaultBinding = (id: AppCommandId, platform: string): string => {
  const command = APP_COMMANDS.find((c) => c.id === id)!
  return platform === 'darwin' ? command.mac : command.other
}

/** The shortcut a command answers to now, or null when the user cleared it. */
export function bindingOf(id: AppCommandId, overrides: Keybindings, platform: string): Shortcut | null {
  const text = overrides[id] ?? defaultBinding(id, platform)
  return text ? parseShortcut(text) : null
}

/** Stored overrides with unknown commands and broken shortcuts dropped ('' = cleared is kept). */
export function cleanKeybindings(raw: Record<string, unknown>): Keybindings {
  const out: Keybindings = {}
  for (const [id, text] of Object.entries(raw)) {
    if (isAppCommand(id) && typeof text === 'string' && (text === '' || parseShortcut(text))) out[id] = text
  }
  return out
}

interface KeyLike {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** Whether a keydown is exactly this shortcut: its key plus its modifiers and no others. */
export function matchesKey(shortcut: Shortcut, event: KeyLike): boolean {
  if (!shortcut.code || shortcut.code !== event.code) return false
  const held: Record<Modifier, boolean> = { Control: event.ctrlKey, Alt: event.altKey, Shift: event.shiftKey, Meta: event.metaKey }
  return (Object.keys(held) as Modifier[]).every((m) => held[m] === shortcut.mods.includes(m))
}

/** The command a keydown triggers, if any. */
export function commandFor(event: KeyLike, overrides: Keybindings, platform: string): AppCommandId | null {
  for (const c of APP_COMMANDS) {
    const s = bindingOf(c.id, overrides, platform)
    if (s && matchesKey(s, event)) return c.id
  }
  return null
}

/** Which other command already uses these keys, for the recorder to say so. */
export function bindingClash(text: string, self: AppCommandId, overrides: Keybindings, platform: string): string | null {
  const wanted = parseShortcut(text)
  if (!wanted) return null
  const same = (s: Shortcut | null): boolean => s !== null && formatShortcut(s) === formatShortcut(wanted)
  return APP_COMMANDS.find((c) => c.id !== self && same(bindingOf(c.id, overrides, platform)))?.label ?? null
}
