# Code orchestration lifecycle

The Code orchestration service is a durable state machine around bounded worker processes.

1. A run is created for one workspace and one objective.
2. Tasks are added directly or through an explicitly accepted DAG proposal.
3. The scheduler checks dependency readiness, trust capabilities, host concurrency, and managed-worktree policy before dispatching a task.
4. Each dispatch receives a lease generation, isolated worktree, selected adapter, bounded prompt, and authenticated event bridge.
5. Heartbeats update liveness. Cancellation and resume operations compare the expected lease generation, fencing late workers.
6. Worker output is bounded and parsed into a result, question, or failure. Questions pause the dispatch and remain durable until answered.
7. Successful work creates a checkpoint for review. Conflicts block fan-in and require an explicit resolution path.
8. The run reconciles task, dispatch, worktree, checkpoint, message, gate, and event state before it can finish.

The Phase 13 Coordination pane is a workspace-native projection of this lifecycle. It can create runs, draft and accept a task graph, add tasks, start/pause/cancel runs, retry or resume dispatches, answer worker questions, inspect events, send addressed messages, acknowledge inbox deliveries, and resolve decision gates.

The database migrations are additive and restart-safe. Historical run tables remain readable; mailbox and gate tables use run/task/dispatch foreign keys and indexed polling paths.
