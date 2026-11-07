# ADR 0056 — Work only: Bots and Chat removed, no title bar

Supersedes ADR 0012 (top-level modes) and ADR 0022 (Bots mode), and with them the parts of ADR 0028,
0029, 0030, 0032, 0039 and 0055 that belong to Bots or Chat. Amends ADR 0044 (Queen Bee put away) and
ADR 0053 (the phone matches the desktop). Decided by the product owner, 2026-11-07.

## Context

Work does everything the other two modes did: agents run in a terminal or a chat view, on a schedule,
with apps, the browser and computer use. Bots (teams, Chief of Staff, threads, triggers, approvals, bot
computers, the work board and team map) and Chat (free-standing chats and scheduled chats) were two
more apps inside the app, and the title bar existed mostly to switch between the three. With one mode
left the title bar was an empty strip above everything.

## Decision

- **Bots and Chat are gone.** No mode switch, no Bots or Chat screens, sidebars or panels; no teams,
  handoffs, triggers, approvals or bot computers; no free-standing chats. Their IPC channels (`bots.*`,
  `teams.*`, `triggers.*`, `approvals.*`, `chat.list`, `chat.create`, `chat.delete`, `bots.screen`) and
  the `bots.open` event are removed, from `REMOTE_CHANNELS` and `MOBILE_CHANNELS` too. The chat engine
  stays: it is how a Work agent runs in chat view (`chat.get`, `send`, `queue`, `stop`, `catalog`, …).
- **Schedules are Work's only.** A schedule always runs a new agent of a CLI in a Worktree
  (`Routine.target` is required and only `kind: 'workspace'`); `botId`, results threads and event
  runs are gone. Saved bots, teams, triggers, bots' schedules, scheduled chats and their runs are
  dropped quietly when the state loads; the files in the chats and bots folders are left on disk.
- **Queen Bee** loses Set mode, the Bots pages, New chat and Message bot; Switch schedule stays.
  Settings › Keyboard loses Go to Work/Bots/Chat and New chat or bot; saved keys for them are dropped.
- **No title bar.** The sidebar, the open worktree's panes and the side panel all start at the top of
  the window (`.main` has page padding on every side). The window's chrome lives in the sidebar card:
  its top bar holds the brand (and DEV/SERVER chips), Queen Bee's mark when she is put away, and the
  side panel and sidebar buttons, and drags the window; its footer holds Settings. Hidden, the sidebar
  folds to an icon rail with the same buttons. macOS's traffic lights sit at the start of the top bar
  (and above the rail). On Windows and Linux the native window controls are transparent and 40 px tall,
  over the top-right card's header: a top bar there (`data-top-bar`, a pane's or the side panel's
  header) is marked `data-under-controls` and leaves them `--window-controls-width` of room.
  Queen Bee's "Put away in the title bar" becomes "Put away in the sidebar" (stored value unchanged).
- The design language is unchanged: same tokens, icons, spacing, colors and radii.

## Consequences

- A user with bots, triggers or chats loses them in the app; nothing on disk is deleted, and an
  older version can still read its state file only if it was not saved since.
- The phone app's Bots and Chat tabs no longer have channels to call: the phone must drop them too
  (its Work, Schedules, files and agents keep working).
- The window-controls room is measured, not laid out: a top bar that moves into the corner without
  resizing is rechecked on the next pane change, resize or window resize.
- Bringing either mode back is a new ADR, not a revert of this one.

## Amendment (2026-11-07): one top-bar height, side panel button on the right

The product owner found the top bars too short and the air above them too tall, and wanted the side
panel's button on the right. Every top bar (the sidebar's, a pane's, the side panel's) is now
`--pane-header-height` (`--control-lg` + `--space-1`, 34 px); above the columns there is `--page-top`
(`--space-3`, a little less than the sides), and the native window controls are 46 px tall so they
centre on the top bars (Windows only lets their height change, never their width or glyphs). The side panel
button leaves the sidebar and its rail: it sits at the top right, on the top bars' centre line, left of
the window controls (at the corner on macOS). The top-right top bar leaves `--top-right-room` for both;
the corner is found by the bar's right edge meeting the main area's, on every platform.
