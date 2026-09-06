# Code orchestration lifecycle

The Code orchestration service is a durable state machine around bounded worker processes.

1. A run is created for one trusted Git workspace and one objective.
2. Tasks are added manually or through a structured graph proposal that the user explicitly accepts.
3. The scheduler checks dependencies, workspace capabilities, host concurrency, path claims, and managed-worktree policy before dispatch.
4. Each dispatch receives a lease generation, isolated managed worktree, selected coding adapter, bounded prompt, and authenticated event bridge.
5. Heartbeats update liveness. Cancellation, retry, and resume compare the lease generation so late workers cannot settle current work.
6. Bounded worker output becomes progress, a question, a completion report, or a failure. Questions pause the affected work until answered.
7. Successful work creates a checkpoint for review. Accepted dependencies can fan into dependent work; conflicts stop the merge and require an explicit resolution path.
8. The run reconciles tasks, dispatches, worktrees, resources, checkpoints, reviews, mailboxes, gates, and events before it can finish.

The Coordination pane is a projection of this state. It can create runs, inspect and accept a graph, add tasks, start or pause work, cancel or retry dispatches, answer questions, review checkpoints, send addressed messages, acknowledge deliveries, and resolve decision gates.

SQLite is authoritative. Migrations are additive and restart-safe; active dispatches become interrupted on restart while their durable worktree and session identifiers remain available for an explicit retry or resume.
