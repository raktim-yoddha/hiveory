# Source intelligence boundary

Phase 13 keeps repository facts in the host and exposes a small, provider-neutral projection to Code mode.

## Local repository facts

`hiveory-git-service` reads repository identity, remotes, current and local branches, upstream divergence, linked worktrees, recent commits, and conflict state. The service receives a workspace root resolved by `hiveory-workspace-service`; the renderer cannot supply an arbitrary filesystem root. Existing status and diff operations remain available for per-file inspection.

The `CodeSourcePanel` groups those facts into Changes, Branches, Commits, Issues, Pull requests, and Checks tabs. Local data remains useful when no hosted account or remote is available.

## Hosted collaboration

`hiveory-desktop/src-tauri/src/hosted_source.rs` invokes the locally authenticated hosted-source CLI with bounded arguments, a 12-second timeout, and a 4 MiB JSON limit. Only parsed repository, issue, and pull-request fields cross the Tauri boundary. Credentials and raw command diagnostics never enter SQLite, renderer state, or logs.

Successful hosted snapshots are cached in `hiveory_code_hosted_tracking_cache`. If a refresh fails and a cache exists, the UI receives the last known data with an explicit stale state. Missing CLI, authentication failure, no remote, offline, rate-limit, and generic errors are separate user-visible states.

## Trust boundary

Source reads require the workspace `ReadGit` capability. Future source mutations must remain explicit host commands, require a trusted workspace, and carry repository/branch-aware confirmation. The current Phase 13 slice is intentionally read-only for hosted collaboration.
