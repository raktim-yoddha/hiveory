# ADR 0008 — Local Data Locations

## Decision

| Data | Location |
|---|---|
| Persisted state (`state.json`) and logs | Electron `userData` (`%APPDATA%\Hiveory`) |
| Isolated Workspace worktrees | `<data root>/Workspaces/<project-slug>-<id6>/<workspace-slug>` |
| Generated per-agent files (hook settings) | `<data root>/Runtime/<instance-id>/` |

`<data root>` is machine-local: `%LOCALAPPDATA%\Hiveory` on Windows,
`~/Library/Application Support/Hiveory` on macOS,
`$XDG_DATA_HOME/hiveory` on Linux. Worktrees are large and machine-specific,
so they never go in the roaming profile.

Development builds use the name `Hiveory Dev` so experiments never touch real
state. `HIVEORY_USER_DATA` overrides `userData` for automated smoke runs.

Branches for isolated Workspaces are named `hiveory/<workspace-slug>`
(suffixed `-2`, `-3`… when taken).

## Consequences

Removing a project from Hiveory leaves its folder and worktrees on disk.
