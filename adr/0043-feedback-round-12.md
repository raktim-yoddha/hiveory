# ADR 0043 — Feedback round 12: browser panes done right, pane spacing, workspace marks

Builds on ADR 0042. Decided by the product owner, 2026-10-11.

## Context

The product owner tried round 11 and asked for the browser pane to follow every pane rule, an
attached (gapless) pane look like Orca's, more ways to mark a Workspace (more icons, emoji, the GitHub
avatar), a tidier Appearance page, remote sessions, and a few corrections.

## Decision

### Corrections
- In the Tabs style a pane's "+" opens a tab, with no Tab | Right | Bottom choice; splitting is a drag
  or a tab's menu.
- A Worktree's bar in the sidebar lists every pane: agents and terminals (busiest first), browser
  pages (globe) and open files, headed "N panes".
- The Dashboard's workspace mark sits on the name's line, a size smaller.

## Consequences

The sidebar bar now needs the browser pages and open files of each Worktree; files are known once a
Worktree has been opened in this session.
