# Code project and workspace hierarchy

## Purpose

Code mode keeps the project list and the active workspace canvas as separate concepts. A project is the durable registration for a folder or Git repository. A workspace is an execution context owned by that project and contains its own panes, terminals, previews, trust state, documents, and layout revision.

```text
Project
├── Primary workspace
├── Managed worktree workspace (Git only)
└── External worktree workspace (future import path)
    └── panes, terminals, previews, documents, trust
```

The global rail is independent of this hierarchy. Dashboard, Routines, Plugins, and Skills change the main content view without replacing the Workspaces section. Selecting a project or workspace explicitly returns to the workspace canvas.

## Add flows

### Add Project

1. The user chooses a local directory.
2. The host canonicalizes the path and rejects non-directories.
3. The host detects whether the directory is a Git repository.
4. The host registers one project and opens its primary workspace as untrusted.
5. The project and workspace records are persisted before the active canvas is selected.

Adding the same canonical directory again is idempotent: the existing primary workspace becomes active instead of creating a duplicate project.

### Add Workspace

1. The user chooses a Git project and supplies a display name.
2. The host resolves the requested base ref and validates the branch name.
3. The host creates a managed worktree below the application-managed workspace root.
4. The new worktree is opened as an untrusted workspace with an independent pane layout.
5. The project count and active workspace are updated after persistence succeeds.

Folder projects expose only their primary workspace because there is no Git ref from which to create an isolated worktree.

## Persistence and migration

The project table owns registration metadata, while workspace rows retain the existing IDs used by pane layouts, documents, terminals, previews, and trust. The migration converts every legacy flat workspace into a project with that workspace as its primary child. This preserves existing layout and runtime references while making the new hierarchy visible to the renderer.

The renderer receives both arrays in `CodeSnapshot` and derives the tree by `project_id` and `primary_workspace_id`. The host remains authoritative for filesystem paths, Git worktree creation, trust capabilities, and persistence.

## Safety rules

- Project paths are canonicalized before deduplication.
- Managed worktrees are created only inside the application-managed root.
- New workspaces start untrusted and cannot launch processes until explicitly trusted.
- User-facing names are bounded and reject control characters.
- Branch names are validated before Git receives them.
- Pane layouts remain scoped by workspace ID, so switching workspaces never leaks terminal or document state.
