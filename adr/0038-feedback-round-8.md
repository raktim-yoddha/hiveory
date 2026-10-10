# ADR 0038 — Feedback round 8: polish after 0.22

Builds on ADR 0019 (Queen Bee), ADR 0033 (Workspaces and Worktrees) and ADR 0037.
Decided by the product owner, 2026-10-11.

## Context

The app is feature-complete for now; this round polishes it and fixes what got in the way. Every
change here ships as a PATCH release (the product owner's call for this polish phase).

## Decision

### Queen Bee's card stays closed until asked for
Live updates (an agent finished, needs you, stopped) no longer pop the card over the work. They
wait behind a message button on her bar, which shows a dot while something is unseen; the button
opens the card and pressing it again closes it. A reply to a command you just gave, a question
and a yes/no still open the card, since you are waiting for them. Closing (the button, Esc, ×, or
a reply timing out) keeps the last message, so the button can show it again.

### Worktrees follow Git; one Workspace per repository
Supersedes the "a Project starts with no Workspaces" part of ADR 0011 and the Restore previous
mode of ADR 0020.
- A Workspace always has its Primary. `WorkspaceService.sync` creates it (unless another Workspace
  already runs agents in that checkout, ADR 0021), imports every linked worktree `git worktree
  list` shows (anywhere on disk, `createdBranch: false`, so Hiveory never deletes those branches),
  keeps each Worktree's branch current, and forgets a Worktree whose folder is gone and that Git
  lists as prunable (or no longer lists), with its agents, then prunes. A Workspace whose own folder
  is gone is left alone and shows as missing.
- Sync runs when a Workspace is added, at startup, when a window comes to the front and every 30 s
  (local Workspaces; SSH ones sync when added). No new IPC channel.
- No duplicates: `treeKey` compares every known checkout app-wide, and adding a folder inside a
  linked worktree opens the repository's main checkout instead.
- Removing the Primary removes the Workspace (`workspaces.delete` on the main Worktree calls
  `projects.remove`): archived, nothing on disk changes, adding the folder again restores it.
- Add workspace loses Restore previous; `projects.previous` and `projects.restore` are gone (no phone
  or server client used them). Create worktree no longer offers the Workspace folder.

## Consequences

- Updates are easier to miss: the dot and the optional spoken update are the only signals.
- A worktree folder on a drive that is unplugged while its repository stays reachable is forgotten
  (its agents with it); adding it back after it returns imports it as a new Worktree.
