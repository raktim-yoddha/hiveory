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

### The sidebar: marks, folding, two-line rows
- A Workspace has an icon and a color (`ProjectSettings.icon` / `color`, a fixed set each; colors
  are theme tokens: the accent and the terminal palette). Unset, the icon is a folder and the color
  is picked from its id. Settings › General › Icon and color sets them.
- The mark replaces the chevron and folds or unfolds the Worktrees. The Workspace row does nothing
  while unfolded; folded, it shows `../<folder>` and the branch of the Worktree last opened there,
  and clicking it opens that Worktree (the Primary when none was opened yet).
- Worktree rows have two lines: the name, then the branch. The Primary shows the Workspace folder's
  name with a "Primary" tag (its stored name stays "Primary" for Queen Bee, ADR 0033).
- "+" opens New branch · Existing branch · Remote branch. Remote fetches origin and checks the
  chosen `origin/x` out as a local `x` that follows it (`git worktree add --track`); a local `x`
  that already exists is used as it is. `git.info` takes `fetch` and returns `remoteBranches`;
  `workspaces.create` takes `remoteBranch`. The SSH host daemon gains `git.remoteBranches` and
  `git.fetch`.

### The Workspace page moves into the side panel
The main-area Workspace page is gone; clicking a Workspace no longer opens it. Its four tabs
(Tasks, Pull Requests, Worktrees, Settings) are a "Workspace" tab of the side panel beside the open
Worktree, without the New worktree button (new worktrees come from the sidebar's "+"). Opening a
Workspace (Add workspace, Queen Bee, right-click › Workspace settings) opens its last Worktree and
that tab. Tasks has All (every Worktree) | Here (only the open Worktree); the columns stack when
narrow.

## Consequences

- Updates are easier to miss: the dot and the optional spoken update are the only signals.
- The board is no longer a full-width page; maximizing the side panel gives it the room back.
- A worktree folder on a drive that is unplugged while its repository stays reachable is forgotten
  (its agents with it); adding it back after it returns imports it as a new Worktree.
