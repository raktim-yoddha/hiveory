# ADR 0042 — Feedback round 11: browser panes, tabbed panes, renaming, avatars, annotations

Builds on ADR 0040 and 0041. Decided by the product owner, 2026-10-11.

## Context

The product owner asked for the browser to live among the panes, Orca-style tabbed pane areas chosen
at onboarding, renaming panes, image avatars and any color for a Workspace, batches of browser
annotations sent to an agent, and a lighter side panel. Asked before building: in the tabbed style a
new agent opens as a tab in the current area; a double left click on a pane or tab title maximizes
it (a double right click renames it); Routines and Workspace settings become side-panel tabs of their
own, not open by default.

## Decision

### Side panel
- A worktree's side panel starts with Dashboard, Sessions and Explorer.
- Routines and Workspace settings are side-panel tabs of their own (from "+", or a Workspace's
  right-click › Workspace settings); the Dashboard keeps Tasks, Worktrees and Issues.
- The Dashboard's section tabs have icons and show only them while the panel is narrow (Tabs
  `iconsWhenNarrow`, a container query); the side panel's own tabs do the same.

### Browser panes
- A browser page is a pane of its worktree, beside agents, terminals and files: same header, drag,
  split, swap and maximize. A pane's "+" offers Browser (placed right or below that pane); pages an
  agent opens join its worktree's layout as panes; Queen Bee opens them as panes too.
- The side panel no longer holds browsers. Main counts a worktree's pages among its panes
  (`AgentService.setExtraPanes`, `BrowserService.pageIdsIn`) and reconciles the layout when one opens
  or closes (`onScopeChange`); `browser.open` takes `beside` to place it.
- The page is a native view: it hides while another pane is maximized and steps aside (leaving a
  picture) while a pane is dragged.

## Consequences

A worktree opened before this keeps the side-panel tabs it had; the defaults apply to new ones.
Browser pages are not restored after a restart (as before), so their panes leave the layout then.
