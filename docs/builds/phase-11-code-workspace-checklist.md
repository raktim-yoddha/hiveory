# Phase 11 — Code Workspace Verification Checklist

## Visual and shell checks

- [x] Code workbench uses one rail instead of nested global and Code rails.
- [x] The shell, workspace, canvas, panel groups, and terminal containers have bounded height and `overflow: hidden` where appropriate.
- [x] The canvas matches the compact dark reference direction: graphite surfaces, thin borders, compact headers, muted text, and restrained blue focus state.
- [x] Tidy and layout presets are available from the title bar and keyboard shortcut.
- [x] Preset dialog uses the same CSS token system as the rest of Code mode.
- [x] Read-only workspaces expose a trust action before process launch.

## Interaction checks

- [x] Empty panes expose shell, agent, preview, and thread launch actions.
- [x] Agent launch exposes a model selector when adapters are detected.
- [x] Header plus, overflow split, drag/drop edge docking, center swap, rename, maximize, and close actions dispatch through the controller.
- [x] Running process close requires an explicit confirmation.
- [x] Stale persisted terminal panes reopen with a launcher instead of a blank terminal.
- [x] Spatial focus and pane shortcuts are wired to the active workspace.

## Transport and host checks

- [x] Terminal input uses UTF-8 base64 across IPC.
- [x] Terminal events include a per-session monotonic sequence.
- [x] Snapshot-before-paint and sequence-gap resync are implemented.
- [x] The PTY output ring is bounded to 1 MiB.
- [x] Windows executable resolution prefers runnable binaries and wraps command shims correctly.
- [x] Host stream filtering honors `after_sequence` and survives a lagged broadcast receiver.

## Verification commands

Run these from the repository root:

```powershell
pnpm --dir hiveory-renderer check
pnpm --dir hiveory-renderer test
cargo test -p hiveory-code-runtime
cargo test -p hiveory-code-domain
cargo test -p hiveory-protocol
cargo check -p hiveory-app-host
pnpm audit:identity
pnpm audit:references
```

The release gate is not complete until the native app build is also run on the target machine:

```powershell
pnpm app:build
```
