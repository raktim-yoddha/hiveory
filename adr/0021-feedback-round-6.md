# ADR 0021 — Product Owner Feedback, Round 6

Builds on ADR 0018–0020. The remote/VM and Bots plan from this round is in
`docs/plans/remote-and-bots.md` (a plan, not a decision yet).

## The side panel belongs to workspaces
**Problem.** A project page showed the side-panel toggle, and the panel opened there with a
browser, an Explorer and Sessions scoped to the project folder. The project page is an overview;
work (agents, browsers, files) happens in workspaces.

**Decision.** The side panel and its title-bar toggle exist only while a workspace is in view in
Work mode. Home, project pages, Chat and Settings have neither. Panel tabs are keyed by workspace id
only; the Explorer takes a workspace (its project-page fallback is gone). Queen Bee's "side panel",
"open a browser" and "open the Explorer" ask the user to open a workspace first.

## One workspace per checkout
**Problem.** One repository could be two projects: its root and a subfolder, a linked worktree
opened as a project, or a removed project restored next to one that covers the same repository.
Each could have its own Main workspace, so agents ran twice on the same checkout (the same
branch, index and files) from one app.

**Decision.** A working tree hosts one workspace across the whole app. A Main workspace's tree is
its project's repository root (the folder itself without Git); an isolated workspace's tree is its
linked worktree. Paths compare after resolving symlinks/junctions, case-insensitive on Windows.
- Creating a Main workspace whose tree another project's workspace already uses is refused, naming
  that project and workspace. The Main workspace can live in either project, just not both:
  removing it from one (nothing on disk changes) frees it for the other.
- Restoring an archived project whose Main workspace would collide is refused the same way, so
  nothing is dropped silently; the user removes the other one first.
- Several projects on one repository stay allowed (monorepo subfolders); their isolated workspaces
  are separate worktrees, and Git itself refuses one branch in two worktrees.
- Existing duplicates from earlier versions are left as they are.

## TUIs crashed when a pane attached late (OpenCode segfault)
**Problem.** OpenCode crashed with "Bun has crashed … Segmentation fault" in a pane. The crash is
in Bun's FFI trampoline into opentui's native renderer (opencode issues #31607, #41483).
**Root cause.** A pane's xterm is created when it first shows. If its CLI was already running
(agents resumed at startup, an unopened workspace, a window reload), the buffered output is
replayed into xterm.js, which answers every capability query in it (device attributes, cursor
position, DECRQM, OSC 10/11 colors) and sends those replies to the live CLI as input, long after
its handshake ended. opentui crashes on late, partial handshake replies; other TUIs see junk input.

**Decision.**
- Replies xterm.js produces while parsing the replay are dropped (`terminal-registry.ts`). Live
  output is still answered normally, so a pane that is open when a CLI starts handshakes as before.
- The smallest grid sent to a PTY is 20×5, in the renderer and in `terminal.resize` validation
  (OpenCode also segfaults near 2×1, opencode #38199).
