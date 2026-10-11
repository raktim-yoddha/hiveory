# ADR 0039 — Feedback round 9: the sidebar, panes everywhere, quieter Queen Bee

Builds on ADR 0038.
Decided by the product owner, 2026-10-11.

## Context

The product owner reviewed round 8 and asked for a denser, calmer and stricter app: one way to
open panes everywhere, the sidebar showing what each Worktree runs, nothing popping over the work,
and fewer menus where a direct choice reads better. Shipped as PATCH releases (ADR 0038).

## Decision

### Sidebar
- Each Worktree has a third line: the logos of its agents and terminals, working ones first,
  re-sorted live as statuses change; "+N" for what doesn't fit the width and a toggle that shows
  them all. Idle logos are dimmed, one that needs you has a waiting-colored ring; each opens its pane.
- Rows are a little roomier; the "Primary" tag sits right after the folder name, with small corners
  (new token `--radius-xs`). Pane counts stay visible on hover.
- A folded Workspace shows only the branch when its last Worktree is the Primary (its folder name
  would repeat the title), otherwise the Worktree's name and branch.
- "+" opens New worktree directly; New branch · Existing branch · Remote branch are tabs at its top,
  switchable at any time (no menu first).

### One repository, one set of Worktrees (amends ADR 0021)
The same folder is never added twice (ADR 0038). Where two Workspaces still share a repository
(its root and a monorepo subfolder), they mirror each other: `WorkspaceRepository.mirrors` finds
them by repository, `workspaces.list` and the board show the one Primary and every Worktree and
agent of that repository in each, and a change in one refreshes the others. A Worktree opens
under the Workspace that owns its record.

### No leftover worktrees, Git when needed
Without Git to ask (a folder that is not a repository), a Worktree whose folder is gone is a
leftover and is forgotten on sync. When no local branch is free, Existing branch says why.
Workspace Settings › Repository offers Initialize Git when the folder has none.

### Terminals wherever panes are chosen
New worktree and the preset editor list Terminals (PowerShell, bash, Git Bash…) above Agents,
and Empty worktree's Open agent menu groups them the same way. "Create empty" still opens none.

### Side panel
Its "+" lists Explorer, Dashboard and Sessions only while they are not open, with no hint text.
The Workspace page tab is called **Dashboard**.

### Queen Bee stays out of the way
Her replies no longer pop open: they wait behind the message button like updates. Settings ›
Queen Bee › Bar › "Pop up replies" (`queenPopups`, off by default) brings the old behavior back.
Questions and yes/no still open, since the command waits for that answer.

### Chat shows real marks
The Chat screen's empty state and a chat with no CLI yet show Hiveory's own logo, and a chat with
a CLI shows that CLI's logo, instead of a generic chat icon.

### Terminal font
Settings › Appearance › Terminal font: Family (installed monospaced families, read by name through
the Local Font Access permission `local-fonts`, allowed for Hiveory's own window only), Size
(8–32 pt, the base a narrow pane still zooms out from), Line height (1.00–2.00), Regular and Bold
weight (100–900), Italic text (off draws it upright by dropping SGR 3 from the output) and Bold text in
bright colors. The default family is JetBrainsMono Nerd Font when installed, then the bundled
JetBrains Mono. `settings.terminalFont` is clamped field by field (`safeTerminalFont`) when stored,
read and changed, and a missing family falls back to the default list, so no value breaks terminals.

### Update schedule and overdue reminders
Settings › Updates keeps its page and gains two rows: Check for updates (Hourly · Every 6 hours ·
Daily; `updateCheckEvery`, default every 6 hours, also on launch) and Remind me about overdue
updates (2 · 4 · 8 hours · Daily; `updateRemindEvery`, default 2 hours). An update is overdue two
days after its release (`releaseDate` from the release feed); dismissing its pop-up ("Later")
hides it for this session unless it is overdue, when it returns after the chosen interval.

### Board order
Columns read Waiting for you · Working · Idle (`BOARD_COLUMNS`), as on the phone. The status
model itself is unchanged (AGENTS.md rule 6).

## Consequences

- A reply is easy to miss with popups off; the dot on her button is the signal.
- Sidebar agent lines load each unfolded Worktree's agent list.
