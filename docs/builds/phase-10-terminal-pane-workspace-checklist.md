# Phase 10 — Terminal-First Multipane Code Workspace Release Checklist

## 1. Compliance & Security Gates

- [x] **Prohibited Identity Audit:** Zero prohibited product names found across all non-whitelisted paths (`pnpm audit:identity`).
- [x] **Reference Guard Audit:** Neutral reference verification passes without errors (`pnpm audit:references`).
- [x] **Path & Traversal Security:** Pure domain path validation strictly blocks absolute paths and parent traversal (`../`).
- [x] **Safe Process Close:** Running terminals require user confirmation before process tree termination.
- [x] **Sandboxed Preview Security:** Sandboxed iframe prevents arbitrary host access or parent window navigation.

## 2. Layout & State Invariants

- [x] **Layout v2 Migration:** Automatically migrates v1 layouts to v2 on read and cleans up unbound editor leaves.
- [x] **Optimistic Concurrency:** Revision checks enforce single-writer consistency (`WHERE workspace_id = ? AND revision = ?`).
- [x] **Split Tree Binary Invariants:** Internal nodes maintain exactly 2 children with ratios clamped between 10% and 90%.
- [x] **Max Leaf Boundary:** Enforces a maximum of 12 simultaneous panes.
- [x] **Spatial Navigation:** Alt+Arrow keys navigate to the nearest neighbor pane in all directions.
- [x] **Layout Presets:** Deterministic arrangement for `Equal Columns`, `Equal Rows`, `Main Left`, `Main Top`, `Grid`, and `Tidy`.

## 3. PTY Runtime & Terminal Stream

- [x] **1 MiB Output Ring Buffer:** Bounded in-memory circular buffer prevents memory exhaustion.
- [x] **Session Reconnect & Snapshot:** React remounts and mode transitions reload scrollback without process drops.
- [x] **Adapter Discovery:** Correctly identifies installed CLI tools (`Codex CLI`, `Claude Code`, `Antigravity`, `OpenCode`).
- [x] **Concurrent PTY Execution:** Runs multiple simultaneous shell and agent processes concurrently.

## 4. Test & Build Verification

- [x] **Cargo Test Suite:** All 231 tests passing (`cargo test --all`).
- [x] **Renderer Lint & Typecheck:** Clean verification without warnings or errors (`pnpm check`).
- [x] **Renderer Unit Tests:** 9 tests passing (`pnpm test`).
- [x] **Desktop Release Build:** Tauri executable and installer packaging verified (`pnpm app:build`).
