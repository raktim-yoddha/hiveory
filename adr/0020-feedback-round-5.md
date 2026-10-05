# ADR 0020 — Product Owner Feedback, Round 5

Builds on ADR 0018 and 0019. Queen Bee's part of this round is in ADR 0019, "Round E notes".

## Projects are never lost
**Problem.** Removing a project forgot its workspaces and agents. Adding the folder again made a
new project id, so its isolated workspaces (worktrees in `Workspaces/<name>-<id6>/`) were left on
disk with nothing pointing at them.

**Decision.**
- **Remove archives.** `ProjectService.remove` stops the project's agents (keeping their records
  and chat history) and moves the project, its workspaces, agents, layouts and open files into
  `PersistedState.archive` (newest 30). Nothing on disk changes.
- **Add restores.** Adding a folder that has an archive entry brings it back whole: same ids, so
  layouts and worktree folders line up, and its terminal agents resume their conversations.
  Agent names stay unique: new names never reuse an archived agent's name.
- **Leftover folders are adopted.** After a project is added, `WorkspaceService.adoptWorktrees`
  turns any linked worktree inside Hiveory's workspaces folder that no workspace (open or
  archived) knows into an isolated workspace again (name = folder, branch from Git). This recovers
  folders left by earlier versions.
- **Restore previous.** `foundWorktrees` scans the workspaces folder for unknown worktrees (repo
  read from each worktree's `.git` file), grouped by repository. Add project lists those with the
  archived projects; restoring one opens it, or adopts into the project already open.

## Add project dialog
One dialog for every way in: the sidebar's button, the empty sidebar link and Home all open it.
- A large "Project name" (optional; defaults to the folder or repository name) and a Local/Remote
  select. Remote is shown but disabled ("coming soon"): there is no remote runtime yet.
- Four ways in: **Pick directory**, **New repository** (a folder with README and a first commit;
  optionally `gh repo create owner/name --private|--public --source … --push`, using the user's own
  `gh` login), **Clone repository** (https or SSH only, `git clone -- url`), and **Restore previous**.
- New repositories and clones go to `~/Hiveory/projects` unless another folder is chosen.
- Trust boundary: folders come only from main's picker (or that default); `projects.add` refuses a
  path the renderer names itself. Clone addresses refuse options and transport helpers. If only the
  GitHub step fails, the local repository is still added and a warning says so.

## Side panel: two areas, draggable tabs, Sessions
- Tabs drag to reorder. Dragging a tab into the lower half shows a "Show below" preview and splits
  the panel into a top and a bottom area, each a surface with its own tabs and "+", sized by a
  divider (`panelSplit`, 0.2–0.8, remembered). Ctrl+Shift+arrows do the same from the keyboard.
- While a tab is dragged the browser page steps aside (`[data-steps-aside]`), so the preview shows.
  `BrowserService.show` parks only pages it would overlap, so each area can show a page.
- The panel has no close button: the title-bar toggle or a narrow drag hides it. (A toggle that
  slid over to the panel's edge was tried and removed: it felt glitchy.)
- **Sessions** tab: `SessionHistoryService` reads Claude Code (`~/.claude/projects`), Codex
  (`~/.codex/sessions`, titles from `session_index.jsonl`) and Gemini CLI (`~/.gemini/tmp`) history,
  read-only, head and tail only, cached by mtime. Workspace · Project · All, search, grouped by
  folder. A session that ran in one of the project's workspaces resumes there as a new pane:
  adapters declare `adoptSession` (Claude: the id is the conversation id; Codex and Gemini: a
  provider session id resumed by id). Session ids must look like ids before they reach a CLI.

## Live model on Kanban cards
`ModelTracker` reads, every 5 s and only when the file changed, the tail of each running agent's
own session file — the last reply's model (Claude Code) or the last turn's (Codex) — and the
runtime carries it as `CliRuntimeDetails.model`. Cards show it as a small mono chip; it follows
`/model` within seconds.

## Focus arrangement
Up to four other panes stack in one column beside the focused one; five or more become
side-by-side columns of at most four in the same half, fullest first (3 + 2, 4 + 4, 3 + 3 + 3).

## Skills folders come from the CLI registry
Adapters declare `skills` (own folder at home and in a project, whether they read the shared
`.agents/skills`, other folders they also load). `skillRoots()` builds the Skills page's folders
from that, so every CLI with skills support has its folder (rule 15), not four hardcoded ones. Chips
show the shared folder, folders an installed CLI reads, and any folder already holding the skill.

## Background running
"Keep agents running in the background" (Settings › Agents, on by default): closing the window
hides it into the system tray and every agent keeps working. The tray reopens Hiveory, shows the
running agent count, and quits for real; a second launch, the dock or Queen Bee's shortcut tap also
show it. Quitting still stops agents; they resume on the next start (ADR 0014).

## Smaller fixes
- Guide reader: "All chapters" is a left-aligned back link above the chapter list.
- Queen Bee › Voice › Get started: three step cards (done steps get a check) and a privacy line.

## Consequences
- `PersistedState` gains `archive`. Older state files load with an empty archive.
- Removing a project frees nothing on disk by design; deleting workspaces stays an explicit action.
- Session history depends on each CLI's private file format; readers skip what they can't parse.
