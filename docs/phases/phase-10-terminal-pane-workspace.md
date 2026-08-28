# Phase 10 — Terminal-First Multipane Code Workspace

- **Status:** Complete
- **Date:** 2026-08-28
- **Primary Deliverable:** Real native Tauri terminal-first multipane Code workspace canvas with optimistic layout revisions, reconnectable PTY runtime with bounded ring buffer, safe process close lifecycle, local browser previews, and docked workspace chat threads.

---

## 1. User-Visible Behavior Delivered

1. **Terminal-First Workspace Canvas:**
   - On opening or switching to a workspace, the canvas presents a fluid dark-themed multipane area with docked resizable panes.
   - Blank workspaces or empty panes show a focused Quick Launcher to spawn Coding Agents, Terminal Shells, Local Previews, or Workspace Threads.
   - The first launched resource fills the canvas completely.

2. **Docked Pane Chrome & Controls:**
   - 34px compact headers with resource icon, status dot, inline editable title, and quick action buttons.
   - Inline title rename via double-click on header title or pressing `F2`. `Enter` commits, `Escape` cancels, and blur commits valid changes.
   - Split (+) button splits the pane (Right by default, or Down from the menu).
   - Maximize/Restore button toggles full canvas view for any individual pane (`Ctrl+M`).
   - Overflow dropdown menu (`...`) provides `Relaunch`, `Relaunch with model...`, `Open shell instead`, `Split Right`, `Split Down`, `Rename (F2)`, `Maximize`, and `Close (Ctrl+W)`.
   - Close (`X`) button cleanly closes panes. If a terminal is running, displays a safe confirmation modal allowing `Cancel` or `Stop and close` with process tree termination.

3. **Multipane Splitting, Movement & Presets:**
   - Nested resizable panel groups with 10%–90% bounds clamp.
   - Deterministic layout presets: `Equal Columns`, `Equal Rows`, `Main Left`, `Main Top`, `Grid`, and `Tidy` (`Ctrl+Shift+T`).
   - Alt+Arrow spatial navigation (`Alt+Left`, `Alt+Right`, `Alt+Up`, `Alt+Down`) focuses nearest neighbor pane.

4. **Multi-Process Concurrency & Reconnectable PTY:**
   - Multiple live CLI and shell processes run concurrently in the same workspace.
   - 1 MiB bounded circular ring buffer captures session backlog per terminal.
   - Mode switching (`Agent` ↔ `Code` ↔ `Chat`), pane movement, or remounts restore complete scrollback from snapshot without process restarts.

5. **Local Previews & Workspace Threads:**
   - Docked sandboxed iframe preview with URL navigation bar, reload, and external browser launch.
   - Docked compact chat thread connected to durable Chat engine with live streaming.

---

## 2. Supported Pane Types and Adapters

| Pane Kind | Description | Supported Adapters / Configurations |
| :--- | :--- | :--- |
| **Coding Agent** | Interactive PTY executing installed coding assistant | `Codex CLI`, `Claude Code`, `Antigravity`, `OpenCode` |
| **Terminal Shell** | Interactive local terminal shell | `PowerShell`, `cmd.exe`, `zsh`, `bash` |
| **Local Preview** | Sandboxed local web preview iframe | `http://localhost:*`, `http://127.0.0.1:*`, HTTPS |
| **Workspace Thread** | Docked assistant chat conversation | Full conversation streaming with durable message storage |

---

## 3. Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `F2` | **Rename Pane** | Inline editable title on the currently focused pane |
| `Ctrl+W` | **Close Pane** | Closes active pane (prompts if process is active) |
| `Ctrl+M` | **Toggle Maximize** | Maximizes focused pane to full canvas or restores |
| `Ctrl+Shift+T` | **Tidy Layout** | Normalizes all panes into a clean, balanced layout |
| `Ctrl+Shift+P` | **Layout Presets** | Opens layout presets selection dialog |
| `Alt+Left` / `Right` | **Horizontal Focus** | Moves focus to the nearest pane on the left or right |
| `Alt+Up` / `Down` | **Vertical Focus** | Moves focus to the nearest pane above or below |

---

## 4. Verification Results

- **Rust Workspace Unit & Integration Tests:** 231 passed, 0 failed (`cargo test --all`).
- **Code Domain Unit Tests:** 12 passed, 0 failed (`cargo test -p agentic-super-app-code-domain`).
- **Code Runtime Tests:** 3 passed, 0 failed (`cargo test -p agentic-super-app-code-runtime`).
- **Renderer Unit Tests:** 9 passed, 0 failed (`pnpm test`).
- **Renderer Lint & Typecheck:** 0 errors (`pnpm check`).
- **Prohibited Identity Audit:** Passed (`pnpm audit:identity`).
- **Reference Guard Audit:** Passed (`pnpm audit:references`).
