# Phase 12 — Project and workspace hierarchy

## Outcome

Code mode now separates registered projects from the workspaces that run inside them. The Workspaces section stays in the fixed application rail while the main content can switch between Dashboard, Routines, Plugins, Skills, and the selected workspace canvas.

## Delivered

- Added durable project and workspace-kind protocol records.
- Added a migration from the former flat workspace table to project-owned primary workspaces.
- Added an Add Project menu action that canonicalizes and registers a local folder.
- Added an Add Workspace menu action for Git projects.
- Added managed Git worktree creation under the application data directory.
- Added independent trust and pane-layout state for each workspace.
- Added project-aware renderer types, sidebar tree rendering, and workspace creation dialog.
- Added browser-preview hierarchy coverage and an architecture record.

## Acceptance criteria

- Adding a folder creates one project and one primary workspace.
- Adding the same folder again activates the existing primary workspace.
- Adding an isolated workspace creates a new Git worktree, branch, workspace record, and empty pane layout.
- Folder projects do not offer isolated-workspace creation.
- Switching global sections does not replace the Workspaces section.
- Project/workspace metadata survives application restart through the migration and persistence layer.
- New workspaces remain untrusted until the user explicitly grants process and write capabilities.

## Verification

~~~powershell
pnpm --dir hiveory-renderer test
pnpm --dir hiveory-renderer check
cargo fmt --all -- --check
cargo test -p hiveory-persistence
cargo test -p hiveory-code-runtime -p hiveory-code-domain -p hiveory-protocol
cargo check -p hiveory-app-host
pnpm audit:identity
pnpm audit:references
~~~

The native release build uses the repository's single release directory and replaces its three published artifacts after a successful build.
