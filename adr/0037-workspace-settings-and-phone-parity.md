# ADR 0037 — Workspace settings, chat or terminal per agent, and the phone's workspace pages

Builds on ADR 0013, 0027 and 0033. Decided by the product owner, 2026-10-09.

## Context

Whether agents open as a chat or a terminal was fixed when a Worktree (or preset) was created:
the "+" menu and the phone's Open an agent had no choice, so a chat Worktree could only add chats
and the other way round. A Workspace's Settings tab held only its folder and Remove. The phone
showed a Workspace's board and Worktrees, but not its settings or pull requests, and an agent's
header did not say which CLI it was.

## Decision

- A Workspace (code: `Project`) has its own settings, `Project.settings` (`ProjectSettings`),
  changed with the new channel `projects.update` (also renames it). Absent fields follow the app:
  - **New agents open as** (`agentView`): Terminal or Chat for every Worktree here; unset, each
    Worktree keeps its own choice. New Worktrees, the create dialog and presets' defaults follow it.
  - **Chat agents start with** (`chatDefaults`): a model and effort per chat CLI, applied when a
    chat agent's conversation is created. Each agent can still change its own.
  - **New worktrees**: a branch prefix (default `hiveory/`) and the branch they start from
    (default: the repository's default branch).
  - **Announce agents** (`alerts`): off means no Queen Bee updates and no phone pushes for agents here.
- Every open chooses: the "+" menu and the phone's Open an agent sheet show Terminal | Chat,
  starting from `opensAsChat(project, worktree)`; `agents.open` takes `chatUi`. Shells and CLIs
  without a chat mode open a terminal; SSH Workspaces only get terminals (unchanged).
- The phone gets the Workspace's pages: Settings (the same settings), Pull requests
  (`github.status`, `github.pullRequests`, `github.createPullRequest`), a Worktree's branch and
  changes (`workspaces.gitStatus`), Terminal | Chat when opening agents and creating Worktrees, and
  the CLI's logo before an agent's name. These channels join `MOBILE_CHANNELS`; app settings,
  deleting and permissions (full access) stay on the computer.

## Consequences

- Stored data: `Project.settings` is optional; a damaged one is dropped, never the Workspace.
- The Worktree's own `chatUi` still exists (presets and Worktrees made before this), but a
  Workspace setting now overrides it for new agents.
- A full-access default per Workspace was left out on purpose: it would let the phone widen
  permissions. Startup commands and environment variables per Workspace are left for later.
