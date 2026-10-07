# ADR 0033 — Workspaces and worktrees: the user-facing names

Corrects a naming mistake that ran through the whole app. Decided by the product owner, 2026-10-08.

## Context

What Hiveory called a **Project** (a folder or repository added to the sidebar) is what people know
as a **workspace**. What it called a **Workspace** (the main checkout or an isolated folder with its
own branch) is a Git **worktree**. The old names made the app harder to understand.

## Decision

Every user-facing word changes:

| Before    | Now       |
| --------- | --------- |
| Project   | Workspace |
| Workspace | Worktree  |

This covers the desktop UI, the phone app, error messages, notifications, the in-app guide, agent
tool descriptions, Queen Bee's replies and the docs (`product-spec.md`, `ui-map.md`, `design.md`,
`AGENTS.md`). The main worktree is still the original folder ("Workspace folder" in Create worktree) and is named
**Primary** (was "Main"). The name is fixed: Create worktree shows it read-only, main ignores any
other name, and older main worktrees ("Main" or a typed name) are renamed on startup.
Queen Bee accepts "primary" and "main" for it.

Code keeps its names: types (`Project`, `Workspace`), ids (`projectId`, `workspaceId`), IPC channels
(`projects.*`, `workspaces.*`), stores, persisted data and the folder Hiveory keeps worktrees in.
Renaming them would need a data migration and a phone/desktop protocol break for no user benefit.
So in code:

- `Project` = the user's **Workspace**
- `Workspace` = the user's **Worktree**

Queen Bee understands both: "add a workspace" adds a Project, "new worktree login-fix" creates a
Workspace, "in worktree X" / "in workspace X" both target a Workspace. The model sees STATE with the
code names and is told the user's words map onto them.

Third-party meanings stay: a Composio project, an EAS project, a pnpm workspace, a bot computer's
`/workspace` folder.

## Consequences

- New UI text uses Workspace / Worktree. New code keeps `Project` / `Workspace` for the entities.
- Earlier ADRs keep their original wording; read "Project" there as Workspace and "Workspace" as
  Worktree.
