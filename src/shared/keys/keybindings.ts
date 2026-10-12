import { formatShortcut, parseShortcut, type Modifier, type Shortcut } from '../queen/shortcut'

/**
 * The app's keyboard shortcuts (ADR 0047), each with the standard keys of its platform: ⌘ on macOS;
 * Ctrl on Windows and Linux, never the Windows/Super key (the system owns it). Where Ctrl + a letter
 * would take a key terminal CLIs use (Ctrl B, Ctrl J…), Windows and Linux add Shift, the way
 * terminal apps do. The user can change or clear any of them in Settings › Keyboard.
 */
export const APP_COMMANDS = [
  { id: 'open-settings', label: 'Open or close Settings', group: 'General', mac: 'Meta+Comma', other: 'Control+Comma' },
  { id: 'toggle-sidebar', label: 'Show or hide the sidebar', group: 'General', mac: 'Meta+KeyB', other: 'Control+Shift+KeyB' },
  { id: 'toggle-side-panel', label: 'Show or hide the side panel', group: 'General', mac: 'Meta+KeyJ', other: 'Control+Shift+KeyJ' },
  { id: 'mode-work', label: 'Go to Work', group: 'Modes', mac: 'Meta+Digit1', other: 'Control+Digit1' },
  { id: 'mode-bots', label: 'Go to Bots', group: 'Modes', mac: 'Meta+Digit2', other: 'Control+Digit2' },
  { id: 'mode-chat', label: 'Go to Chat', group: 'Modes', mac: 'Meta+Digit3', other: 'Control+Digit3' },
  // Only in Chat and Bots, where no terminal needs Ctrl N; in Work the key reaches the terminal.
  { id: 'new-item', label: 'New chat (in Chat) or new bot (in Bots)', group: 'Chat and Bots', mac: 'Meta+KeyN', other: 'Control+KeyN' }
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

/** Who already uses these keys (another command, or Queen Bee), for the recorder to say so. */
export function bindingClash(text: string, self: AppCommandId | 'queen', overrides: Keybindings, queen: Shortcut, platform: string): string | null {
  const wanted = parseShortcut(text)
  if (!wanted) return null
  const same = (s: Shortcut | null): boolean => s !== null && formatShortcut(s) === formatShortcut(wanted)
  if (self !== 'queen' && same(queen)) return 'Queen Bee'
  return APP_COMMANDS.find((c) => c.id !== self && same(bindingOf(c.id, overrides, platform)))?.label ?? null
}
