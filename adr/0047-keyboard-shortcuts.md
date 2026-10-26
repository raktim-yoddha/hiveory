# ADR 0047 — Keyboard shortcuts with each platform's standard keys

Builds on ADR 0019 and 0044. Decided by the product owner, 2026-10-12.

## Context

Hiveory had almost no shortcuts, and they could not be changed: Ctrl/⌘ N made a new bot, and Queen
Bee's Win + Alt (⌘⌥ on a Mac) was the only one with a setting. Win + Alt leans on the Windows key,
which belongs to the system, and no shortcut followed the conventions people know from other apps.

## Decision

- **Settings › Keyboard** lists every shortcut. Each can be changed by pressing new keys, removed, or
  reset; one button resets them all. Fixed keys (terminal copy and paste, Shift Enter, find and save
  in a file, Explorer keys, moving side panel tabs, swapping panes) are listed there too, read-only.
- Shortcuts use each platform's standard: ⌘ on macOS; Ctrl on Windows and Linux, never the
  Windows/Super key. Where Ctrl + a letter would take a key terminal CLIs use, Windows and Linux add
  Shift, the way terminal apps do.

  | Command | macOS | Windows and Linux |
  | --- | --- | --- |
  | Call Queen Bee (tap: type, hold: talk) | ⌥ Space | Ctrl Shift Space |
  | Open or close Settings | ⌘ , | Ctrl , |
  | Show or hide the sidebar | ⌘ B | Ctrl Shift B |
  | Show or hide the side panel | ⌘ J | Ctrl Shift J |
  | Go to Work, Bots, Chat | ⌘ 1, 2, 3 | Ctrl 1, 2, 3 |
  | New chat (in Chat) or new bot (in Bots) | ⌘ N | Ctrl N |

- Queen Bee's old default Win + Alt / ⌘⌥ is gone. A stored `queenShortcut` of `''` means the platform's
  standard keys, and a stored `Meta+Alt` (the old default) becomes `''` on load. Her presets are the
  standard keys plus two alternatives per platform.
- `AppSettings.keybindings` stores only the user's changes (`''` = no shortcut); unknown commands and
  broken shortcuts are dropped on load. The commands, their defaults and matching live in
  `src/shared/keys/keybindings.ts`; the renderer listens once (`useAppShortcuts`), in the capture
  phase so a focused terminal never swallows them. A dialog keeps its keys; only Settings' own
  shortcut reaches past Settings, to close it. "New" passes its keys on in Work, where a terminal
  may want Ctrl N.
- Recording refuses keys the system or terminals rely on and keys another shortcut (or Queen Bee)
  already uses, and says which. Title bar tooltips show the current keys. Queen Bee can open
  Settings › Keyboard ("open keyboard shortcuts").

## Consequences

The settings file gains `keybindings`. Someone used to Win + Alt has to learn the new keys (or record
Win + Alt again). There is no command palette yet, and panes have no shortcuts of their own beyond
the fixed ones.

## Amendment (2026-10-26): shortcuts for most of what people do

Decided by the product owner: the app lacked shortcuts. Researched against Windows Terminal, VS Code,
iTerm2 and chat apps, keeping this ADR's rules (⌘ on macOS; on Windows and Linux never Ctrl + a
letter a terminal needs, so Ctrl + Shift or Alt instead). Every one is in Settings › Keyboard and can
be changed or removed.

- **General:** Show keyboard shortcuts ⌘/ · Ctrl Shift /; Maximize or restore the side panel ⌘⇧M ·
  Ctrl Shift M; Open Schedules (the mode's own calendar, ADR 0055) ⌘⇧S · Ctrl Shift S.
- **Lists:** New worktree ⌘⇧N · Ctrl Shift N (opens Create worktree for the open Workspace; the dialog
  now lives in the shell, `useNewWorktree`); Next / Previous chat, bot or worktree ⌘⌥↓ / ⌘⌥↑ ·
  Alt ↓ / Alt ↑. "Chat and Bots" is now the Lists group.
- **Panes and tabs** (the open worktree only; elsewhere the keys pass through): New tab (the area's
  "+" picker) ⌘T · Ctrl Shift T; New terminal tab ⌘⌥T · Ctrl Shift `; Close the tab ⌘⇧W · Ctrl Shift W;
  Next / Previous tab ⌘⇧] / ⌘⇧[ · Ctrl Tab / Ctrl Shift Tab; Next / Previous area ⌘⌥→ / ⌘⌥← ·
  Ctrl Alt → / ←; Maximize or restore the pane ⌘⇧↩ · Ctrl Shift Enter; Split the tab out right / below
  ⌘D / ⌘⇧D · Alt Shift = / Alt Shift -.
- **Chat:** Type in the message box ⌘L · Ctrl Shift L; Esc in a message box stops the reply (built in).
- Mechanics: pane slots carry `data-pane-id`; the pane the keyboard was last in is the current one
  (`work-commands.ts`); `pane-commands.ts` gains the layout's maximizer beside the closers.

Not added: zoom (Windows and Linux have no app menu to provide it), a command palette, and per-number
tab jumps.
