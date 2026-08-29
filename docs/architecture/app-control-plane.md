# Application coordination boundary

Phase 13 uses the desktop host as the authority for Code-mode coordination. React requests typed Tauri commands; it does not inspect or automate terminal DOM nodes.

## Durable addresses

Each run can address a coordinator, worker dispatch, user, or system participant with a stable run-local address such as `coordinator:<id>` or `worker:<dispatch-id>`. A mailbox delivery contains sender, recipient, kind, payload, optional thread, FIFO sequence, and acknowledgement state.

Mailbox deliveries are stored separately from the historical activity stream. This keeps the audit stream append-only while allowing an inbox to be replayed after a restart. Client request IDs make retried sends idempotent. Payloads and inbox queries are bounded by the host.

Worker bridge events are authenticated with the dispatch lease secret and are rejected when the dispatch, lease generation, nonce, or signature is stale. Accepted progress, question, answer, escalation, and completion events are routed to the coordinator mailbox as durable deliveries.

## Decision gates

High-impact coordination choices are represented by an explicit gate. A gate names its run, optional task or dispatch, reason, allowed actor, state, resolution, and optional expiry. Only an open gate and its allowed actor can be resolved. Opening or resolving a gate creates normal run activity so the decision remains inspectable.

## Current adapter boundary

The current vertical slice exposes mailbox and gate operations through typed host commands and the Coordination pane. Process creation, cancellation, leases, heartbeats, worktrees, questions, checkpoints, and recovery remain owned by the existing orchestration service. A future standalone local client can bind to the same contracts without moving process authority into the renderer.
