# ADR 0040 — Feedback round 10: agent bars, integrations and Work routines

Builds on ADR 0039.
Decided by the product owner, 2026-10-11.

## Context

The product owner reviewed round 9 and asked for a worktree's agents to read as one bar that unfolds
into a list, a calmer title bar, worktrees without panes, GitHub features that visibly work, more
code hosts and issue trackers, and routines that belong to Work instead of borrowing the Bots page.
Shipped as PATCH releases (ADR 0038).

## Decision

### Sidebar
- A Worktree's agents and terminals sit in one rounded bar under its row: a chip per agent (its
  status dot and CLI logo), busiest first, "+N" for what doesn't fit, a chevron that unfolds it.
  Unfolded, it is a list headed "N agents": status dot, logo, pet name · status and how long it has
  been in that status. Every chip and row opens its pane.
- The pane count at the end of a Worktree's row is gone. In its place a loop spins while any agent
  in that Worktree is working.
- The sidebar toggle in the title bar stays where it sits while the sidebar is open, open or closed.

### New worktree
One Create button. With no panes chosen it creates an empty Worktree (Open agent, Load preset);
"Create empty" is gone.

### Routines in Work (amends ADR 0030)
Routines stay one engine (schedules, runs, catch-up, keep-awake, the run log; ADR 0028, 0030), but
Work's are Work's own:
- The Dashboard has a **Routines** tab: the routines of this Workspace's worktrees, their run log, and
  New routine (for the open Worktree). A Worktree's "Schedule a routine…" opens the editor in place;
  nothing switches to Bots mode. The editor is mounted once for the whole app.
- A Work routine's editor picks only its Worktree and CLI (the Workspace is fixed, named in its title).
- Bots' Routines page, calendar, run logs and work board show bots' routines and scheduled chats only;
  its editor no longer offers "A new agent in a Work worktree". `isWorkRoutine` draws the line.

## Consequences

The bar needs the agents of every visible Worktree loaded; they already were for the logo line.
Work routines are no longer on the Bots calendar: a user looking for every schedule in one place
looks in two (Bots, and each Workspace's Dashboard).
