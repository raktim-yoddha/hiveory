# ADR 0048 — Panes by command, and terminals that fit the phone

Builds on ADR 0024 (Queen Bee runs the app) and ADR 0039 (typing on the phone). Supersedes ADR 0027
on resizing terminals from the phone. Decided by the product owner, 2026-10-13.

## Context

Feedback from a user of the desktop and phone apps, compared with Orca:

- Queen Bee could open panes but not lay them out: "arrange them in a grid" was not understood.
  Her rules knew only "tidy up the panes" and "side by side", and she had no way to swap, move or
  resize a pane.
- On the phone a terminal kept the computer's size, scaled down to the phone's width, so it was
  tiny or had to be panned. Orca sizes the terminal to the phone while it is open there and back
  to the desktop when the user returns.
- On Android the keyboard covered the buttons under an agent's terminal (Esc, Enter, the key bar):
  since Expo SDK 54 Android apps are edge to edge, the window no longer shrinks for the keyboard,
  and the agent and chat screens only made room for it on iOS.
- Terminal work on the phone needs Ctrl, Alt and the arrow keys, which the key bar lacked.

## Decision

**Queen Bee lays out panes.** In the current worktree, by agent name:
- `arrange {layout}`: `equal` (a grid), `columns`, `rows` (new, stacked top to bottom) or `focus`
  with an `agentId` (that agent's pane takes half, as when dragging to the top edge). "Arrange them
  in a grid", "grid layout", "tile the panels", "stack the agents", "show them in rows", "make
  Bruno the main pane", "give Luna half the screen".
- `swap-panes {agentId, targetAgentId}`: "swap Bruno and Luna".
- `move-pane {agentId, side, targetAgentId?}`: beside another agent ("put Bruno below Luna") or
  along the layout's edge ("move Luna to the left").
- `resize-pane {agentId, size}`: bigger, smaller, wider, narrower, taller or shorter, a step of
  15% of the pane's split taken from or given to its neighbours (`growPane`).
- The rules live in `pane-commands.ts`; the model tier gets the same actions. Messages still win
  ("tell Bruno to make the logo bigger" is a message), and "focus Bruno" still jumps to the pane.
- Agents' `arrange_panes` tool accepts `rows` too. Dragging a pane still offers the three
  arrangements it had.

**A terminal fits the phone while the phone shows it.** This replaces ADR 0027's "anything that
resizes a desktop terminal stays on the desktop".
- The phone's terminal page measures the grid that fills its screen at 12px text and opens that
  terminal's event stream with `cols` and `rows`. For a phone device the server sizes the terminal
  to it (`fitTerminal` → `PtySession.fitViewer`) and gives the size back when that stream closes,
  so a phone that dies or drops off never leaves the desktop small.
- Several phones: the newest one watching wins; when none is left, the desktop pane's own size
  applies again. The desktop's resizes meanwhile are remembered, not applied.
- There is no call for it: only an open stream sizes a terminal. Sizes are bounded like
  `terminal.resize` (20–1000 columns, 5–1000 rows). A desktop client's streams never size anything.
- A page that has not been laid out yet sends no grid, and the terminal keeps the computer's size;
  an older computer ignores the grid.

**The phone's keys stay above the keyboard.** The agent and chat screens make room for the keyboard
on Android as on iOS. The key bar scrolls sideways and holds Esc, Tab, Ctrl, Alt, ← ↑ ↓ →, / and a
fixed Enter; Ctrl and Alt are held for the next key, typed or tapped (xterm encodings, Ctrl+arrow
as `ESC [1;5D`), then let go. Taps never close the keyboard.

## Consequences

- While the phone watches, the desktop pane shows the agent's output at the phone's width; the CLI
  redraws at full width when the phone leaves. Output from before the phone opened it is replayed at
  the new width and may wrap.
- The terminal size follows the screen as it was when opened; opening the keyboard scrolls the page
  to the prompt instead of resizing the terminal again.
- Not done: maximizing a pane by command (maximize is still the pane's own button), rearranging
  panes from the phone, and sheets (`CustomSheet`) keep their iOS-only keyboard handling.
