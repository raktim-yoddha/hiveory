# Application coordination boundary

The desktop host is the authority for Code-mode coordination. React sends typed Tauri commands and renders projections; it does not inspect terminal DOM state, automate terminal keystrokes, own worker processes, or settle durable orchestration state.

## Durable addresses

Each run can address a coordinator, worker dispatch, user, or system participant through a stable run-local address such as `coordinator:<id>` or `worker:<dispatch-id>`. A mailbox delivery records sender, recipient, kind, bounded payload, optional thread, FIFO sequence, and acknowledgement state.

Mailbox deliveries are separate from the append-only activity stream. This allows inbox replay after restart while preserving historical events. Client request IDs make retried sends idempotent, and recipient sequence numbers preserve ordering.

Worker bridge events are authenticated with the active dispatch lease secret. The host rejects an event when its dispatch, lease generation, sequence, nonce, or signature is stale. Accepted progress, question, answer, escalation, and completion events are routed through durable run records.

## Decision gates

A high-impact coordination choice is represented by a gate with a run, optional task or dispatch, reason, allowed actor, state, resolution, and optional expiry. Only an open gate and its allowed actor can resolve it. Opening and resolving a gate also creates normal run activity so the decision remains inspectable.

## Process and resource ownership

Process creation, cancellation, heartbeats, leases, worktrees, path claims, questions, checkpoints, reviews, terminal resources, completion reports, and restart recovery stay inside Rust services. The Coordination pane can request supported transitions but cannot fabricate a worker identity or widen workspace trust.

Any future external local control client must bind to the same typed contracts and authentication rules. It cannot move process authority into a web renderer.
