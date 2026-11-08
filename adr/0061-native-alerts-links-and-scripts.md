# ADR 0061 — Native desktop: agent notifications, badge, links, jump list and scripts

Builds on ADR 0027, 0037, 0047, 0057 and 0060. Decided by the product owner, 2026-11-08.

The product owner asked for Hiveory to behave like a native app, the way the Claude and Codex desktop
apps, Paseo and T3 Code do, in every mode and on the phone.

## Context

Hiveory already watched every agent's status for phone pushes (ADR 0057), but the desktop said nothing
when an agent finished or needed you unless you were looking at it. There was no taskbar or dock
badge, no way to open Hiveory at a Workspace from another app, no jump list, and every recurring
command (`pnpm dev`, the tests) had to be typed into a terminal again. Paseo has workspace scripts
and OS notifications; T3 Code has prompt links, notifications and a badge.

## Decision

- **Agent notifications.** The status watcher's updates (needs you, finished, stopped) become an
  `agent.alert` event, sent only when Settings › Agents › **Desktop notifications** asks for it
  (`desktopAlerts`: all, needs-you only, off; default all) and never for a Workspace with alerts off.
  Each window shows it as a native notification (`app.notify`, answered by the window's own machine)
  unless that agent's worktree is on screen and the window is in front. Clicking it opens that agent.
  The renderer's own Notification permission stays denied: main shows the notification.
- **Attention badge.** Main counts the agents that need you (`agents.attention`, event and call).
  The window shows it with `app.setAttention`: the dock badge on macOS, the badge count on Linux, a
  taskbar overlay dot on Windows; one more flashes the taskbar (bounces the dock) while Hiveory is not
  in front.
- **hiveory:// links.** `hiveory://open?p=<workspace>&w=<worktree>` opens a Workspace or worktree;
  `hiveory://new?prompt=<text>[&p=…&w=…]` opens a Chat UI there with the text as its draft. A link
  never sends, runs or changes anything else. Prompts are at most 8,000 characters; ids are plain ids;
  anything else is ignored. Installed builds register the scheme (development builds and tests never
  take it); macOS delivers links through `open-url`, Windows and Linux through the second instance's
  arguments; a link that starts Hiveory waits for the window (`app.pendingLink`). Find › **Copy a link
  to this worktree** makes one.
- **Jump list and dock menu.** The six Workspaces worked in most recently, through `app.setRecent`:
  the Windows taskbar jump list (each an `hiveory://open` link) and the macOS dock menu.
- **Workspace scripts.** Workspace settings › **Scripts**: up to 20 named, one-line commands
  (`ProjectSettings.scripts`). The pane "+", Find (Run script), Workspace settings (Run) and the
  phone's Open an agent start one as a new terminal tab of the worktree, named after it, and type its
  command once the shell is up. It uses the existing `agents.open`, `agents.rename` and
  `terminal.write`; no new way to run commands is added.
- The window's own machine answers `app.notify`, `app.setAttention`, `app.pendingLink` and
  `app.setRecent` (CLIENT_LOCAL_CHANNELS), so all of this works when the window is a client of a
  Hiveory server; `agents.attention` is a remote channel.

## Consequences

- Notifications depend on the operating system's own settings (Focus Assist, Do Not Disturb).
- The phone keeps its push notifications for "needs you" (ADR 0027); "finished" stays desktop-only.
- Scripts are not a process supervisor: a script's terminal is an ordinary terminal pane, stopped by
  closing it. Ports, health checks and a service proxy (as in Paseo) are left for later.
- Voice dictation is not included: Electron has no built-in speech service, and sending audio to a
  provider needs its own decision.

## Amendment (2026-11-08): window, drops, area keys and agent scripts

- The window reopens where it was, at its size and maximized or not, when that place is still at
  least half on a connected screen (`window-state.json` in the app's data folder); otherwise it opens
  at its default size.
- Files dropped on a terminal pane type their paths at its prompt, quoted for this platform's shells,
  as a paste. A terminal on an SSH host or behind a Hiveory server refuses the drop and says why: the
  files are on this computer, not there.
- Ctrl+F6 / Ctrl+Shift+F6 (⌘ on macOS; a modifier is required, ADR 0047) move the keyboard between
  the sidebar, the open worktree and the side panel, each getting back the control that last had focus.
- Agents get `list_scripts` and `run_script`: a script starts in a terminal pane beside the agent,
  named after it, and the tool returns its first output.

## Amendment (2026-11-08): agents browse while the window is away

- An agent's browser page keeps its last real size (1280×800 for a new one) while Hiveory's window is
  minimized, hidden or never shown, so snapshots, clicks and screenshots work as when it is on screen.
  Before, a page opened then was laid out at 0×0 and agents saw an empty page.
- On Windows, closing the window in Background mode now minimizes it and takes it off the taskbar
  instead of hiding it: a hidden window draws nothing, so no screenshot of an agent's page could be
  taken. It looks the same to the user; the tray icon brings it back. macOS and Linux still hide it.
- After the window comes back from the tray, its place and size are remembered again.

## Amendment (2026-11-09): links in terminals

- Ctrl+click (⌘+click on macOS) on a web address in a terminal's output opens it in a browser pane
  beside that terminal; on a file path (`src/app.ts:12:5`, `app.py(12,5)`, `guide.md#L12`, absolute or
  relative) opens the file in an editor pane beside it, at that line and column. The CLI's own OSC 8
  hyperlinks open the same way. A plain click stays a click (selection, the CLI's own mouse).
- Only files of the worktree open: a path outside it is refused with a notice, and a name that is not
  an existing file says so instead of opening an empty pane. No new IPC channel: links use
  `browser.open`, `files.read`, `editors.open` and `layout.apply`.
- Detection is per row and per character: links wrapped across rows, or after wide glyphs, may be
  missed or offset.
- A terminal (not an agent: agents show their status) that prints while out of sight, in a background
  tab or a worktree not on screen, shows a ring on its tab, "New output", until it is on screen again.
  Kept in the renderer only (`useTerminalActivity`); nothing is stored.
