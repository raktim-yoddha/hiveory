# Code orchestration lifecycle

The Code orchestration service is a durable state machine around bounded worker processes.

1. A run is created for one trusted Git workspace and one objective.
2. Tasks are added manually or through a structured graph proposal that the user explicitly accepts.
3. The scheduler checks dependencies, workspace capabilities, host concurrency, path claims, and managed-worktree policy before dispatch.
4. Each dispatch receives a lease generation, isolated managed worktree, selected coding adapter, bounded prompt, and authenticated event bridge. The current managed-worker adapters are Codex CLI, Claude Code, Antigravity, and OpenCode, subject to local installation.
5. Heartbeats update liveness. Cancellation, retry, and resume compare the lease generation so late workers cannot settle current work.
6. Bounded worker output becomes progress, a question, a completion report, or a failure. Questions pause the affected work until answered.
7. Successful work creates a checkpoint for review. Accepted dependencies can fan into dependent work; conflicts stop the merge and require an explicit resolution path.
8. The run reconciles tasks, dispatches, worktrees, resources, checkpoints, reviews, mailboxes, gates, and events before it can finish.

The Coordination pane is a projection of this state. It can create runs, inspect and accept a graph, add tasks, start or pause work, cancel or retry dispatches, answer questions, review checkpoints, send addressed messages, acknowledge deliveries, and resolve decision gates.

A supported visible coding-CLI pane can use a session-scoped host bridge to inspect or create runs and tasks, send or receive mailbox deliveries, open or assign visible workers, report completion, and read the Skills catalog. The host also supplies scoped browser (including `browser.close`), computer, configured plugin tools, and pane-prompt delivery; `agent_panes.wait_delivery` waits at most 60 seconds for a durable delivery result. Prompt delivery checks the shared terminal safety gate every 50 ms and submits a bracketed paste after 100 ms for every adapter. A ready terminal can receive consecutive durable deliveries without requiring a renderer-focus redraw; a request that cannot become ready within 60 seconds fails durably. The bridge has a per-session token, exposes only its tool manifest, and confines orchestration requests to its workspace; it is not Hiveory Agent execution.

SQLite is authoritative. Migrations are additive and restart-safe; active dispatches become interrupted on restart while their durable worktree and session identifiers remain available for an explicit retry or resume.

## Coding-agent pane status

Every Hiveory-launched local coding-agent pane—whether opened in the renderer or by another CLI—has a durable session, terminal, and pane binding plus a current status projection. The host records launch, queue, delivery, stop, exit, and task-assignment facts by the visible terminal binding; an authenticated session bridge lets only that pane report `working`, `waiting`, `blocked`, `idle`, `completed`, or `failed` with a monotonic per-pane sequence. Reports produce an ordered workspace event cursor and are deduplicated when retried or received out of order. Status is not inferred from terminal titles or output. After 30 minutes without a fresh active report, or after a host restart, the status becomes explicit `unknown` until new host evidence or a CLI report arrives. The Coordination pane and pane headers show these local statuses alongside managed dispatches.
