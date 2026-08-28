# Phase 11 — Code Workspace Fidelity and Runtime Reliability

## Status

Implemented on 2026-08-28. This phase hardens Code mode around the supplied visual reference and turns the terminal canvas into a usable, reconnectable desktop workspace.

## User outcome

Opening Code mode now presents one compact application rail and one bounded canvas. A workspace can contain an empty launcher, native shell sessions, installed coding-agent sessions, local previews, and workspace threads. Each resource lives in a titled pane that can be split, resized, moved, focused, maximized, renamed, relaunched, or closed with a running-process confirmation.

## Delivered behavior

### Shell and visual fidelity

- Removed the duplicate navigation rail from Code workbench.
- Bounded the shell to the application viewport so the document cannot create a phantom right scrollbar.
- Added compact graphite surfaces, muted borders, restrained blue actions, terminal typography, status dots, and reference-shaped pane chrome.
- Added a top-bar Tidy action and a keyboard-accessible layout preset dialog.
- Kept global Dashboard, Routines, Plugins, and Skills navigation available from the Code rail.
- Restored the trust affordance for read-only workspaces before process execution.

### Canvas interactions

- Launch shell or detected coding-agent panes from the empty-pane launcher.
- Choose a model before launching an installed coding-agent adapter.
- Add a pane with the header plus action and split it right or down from the overflow menu.
- Drag a pane onto another pane to dock it left, right, above, below, or swap its contents at the center drop zone.
- Double-click a pane title or press `F2` to rename it.
- Use `Ctrl+M` to maximize or restore, `Ctrl+W` to close, `Ctrl+Shift+T` to tidy, and `Ctrl+Shift+P` to open presets.
- Use `Alt+Arrow` keys to focus the nearest pane in a direction.
- Confirm termination before closing a running process.
- Render a launcher for persisted terminal panes whose in-memory process no longer exists, avoiding blank dead panes after restart.

### Terminal reliability

- Terminal input crosses the IPC boundary as UTF-8 base64, preserving control bytes and pasted Unicode.
- Terminal events carry a monotonic per-session sequence.
- The renderer subscribes before loading the snapshot, buffers the race window, detects sequence gaps, and reloads the bounded snapshot when necessary.
- The runtime keeps a bounded 1 MiB scrollback ring and reports attach, resize, write, interruption, and resync failures in the pane.
- Windows executable discovery prefers directly runnable binaries and correctly invokes command or batch shims when necessary.

## Files changed

- `agentic-super-app-renderer/src/agentic-super-app-shell.tsx`: Code mode gets the dedicated single-rail shell.
- `agentic-super-app-renderer/src/code-workspace/`: pane canvas, launchers, interactions, layout presets, terminal projection, and CSS.
- `agentic-super-app-renderer/src/api/agentic-super-app-client.ts`: preview and native terminal transport contract.
- `agentic-super-app-crates/agentic-super-app-protocol/src/lib.rs`: terminal input and event sequence fields.
- `agentic-super-app-crates/agentic-super-app-code-runtime/src/lib.rs`: PTY stream, executable resolution, and sequence assignment.
- `agentic-super-app-desktop/src-tauri/src/lib.rs`: stream filtering and lag recovery behavior.

## Scope boundary

This phase improves the Code workspace itself. It does not claim that every external command is installed, authenticated, or compatible with a user's machine. Detection and launch errors are surfaced in the UI; users still control workspace trust and credentials.

