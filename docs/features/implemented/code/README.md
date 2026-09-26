# Code workspace and orchestration

**Status:** Current Code mode. Native workspace, filesystem, process, and Git behavior is host-owned. Coding CLIs require local installation and authentication where applicable.

## Inventory

- Workspaces, project hierarchy, trust, and saved layouts are managed by Rust services. See `src/crates/modes/code/hiveory-workspace-service/src/` and [workspace hierarchy](../../../architecture/code-project-workspace-hierarchy.md).
- Workspace panes include terminal, coding CLI, browser, file/editor, Markdown/preview, and coordination surfaces. Automatically created terminal, coding-CLI, Browser, and new Markdown panes receive one collision-safe generated display-name policy. Renderer implementation lives under `src/apps/renderer/src/features/modes/code/workspace/`; pane and terminal contracts are in [terminal pane workspace](../../../architecture/terminal-pane-workspace.md).
- Terminal sessions and child processes are owned by the native host, not the renderer. The renderer redraws an existing terminal after scroll, Code-mode return, or window restore without restarting its PTY. See `src/crates/modes/code/hiveory-terminal-host/src/` and `src/crates/modes/code/hiveory-code-runtime/src/`.
- Git and hosted-source operations have dedicated host services. See `src/crates/modes/code/hiveory-git-service/src/` and [source intelligence](../../../architecture/source-intelligence.md).
- Code runs and worker coordination use a durable task/run model. See `src/crates/modes/code/hiveory-code-orchestration/src/` and [orchestration lifecycle](../../../architecture/code-orchestration.md).
- Supported coding-CLI panes receive a session-scoped, host-owned tool bridge for run/task coordination, addressed mailbox delivery, visible-worker panes, pane status, skills, and configured browser, computer, and plugin tools. Every Hiveory-launched local coding-agent pane shows a readable semantic status in its header and has a durable status projection in Coordination; host lifecycle facts and authenticated CLI reports are shown, while status becomes explicit `unknown` after restart until refreshed. Direct prompt delivery is host-to-PTY and does not require renderer focus. The bridge is available only to adapters with verified session integration, keeps requests within the current workspace, and does not make the CLI a Hiveory Agent run. See [the internal protocol](../../../architecture/internal-protocol.md).

## Edition boundary

Code mode is separate from Hiveory Agent execution. Production excludes private Agent runtime; Dev builds may load that runtime from the private sibling checkout. Do not infer Hiveory Agent availability from a local coding CLI pane or Code orchestration worker. See [private Dev boundary](../../../architecture/private-feature-boundary.md).

## Cross-layer ownership

Renderer surfaces use typed calls in `src/apps/renderer/src/shared/api/`. Native commands and startup are registered in `src/apps/desktop/src-tauri/src/application/`; domain policies, process services, and SQLite remain Rust-owned. The renderer cannot grant itself workspace trust or claim a host process completed.
