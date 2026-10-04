# ADR 0010 — Workspace and Agent Lifecycle Details

Decisions the base docs left open, recorded so they are not silently changed.

## Main Workspace

Superseded by ADR 0011: the main Workspace is created explicitly by the user.
Its id is `<projectId>--main`.

## Projects without Git

Only the main Workspace is available. Creating an isolated Workspace explains
why (not a repository / no commits yet) instead of initializing Git.

## Stopped agents

After a restart or exit, agent instances remain configured with
`running: false` and appear in the **Idle** column with "Not running" /
"Session ended". ~~Processes are never relaunched automatically~~ — superseded
by ADR 0014: every agent is relaunched on start-up and resumes its own
conversation; Start / Resume remains only for dead ends.

## Presets

Presets are global (not project-scoped). Loading a preset is allowed only into
an empty Workspace and creates its agents in a grid; it never merges with
running agents.

## Deleting a Workspace

Agents are stopped first. A dirty worktree requires a second explicit
confirmation (`--force`). The branch is deleted with `git branch -d` only, so
unmerged work is always kept and the user is told.

## Sidebar

Expanding a project in the sidebar lists its Workspaces for navigation. This
is navigation only; workspace actions stay on the Workspace and Workspaces tab.
