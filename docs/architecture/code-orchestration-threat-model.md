# Code coordination threat model

## Assets

- user workspace files and uncommitted changes;
- repository credentials held by the local authentication session;
- terminal input/output and worker process identity;
- durable run, task, dispatch, message, checkpoint, and gate history.

## Controls in the Phase 13 slice

- Workspace roots are resolved by the host and canonicalized before Git or process work.
- Write-capable orchestration requires explicit workspace trust and the required capabilities.
- Worker processes run in managed worktrees by default; a PID is never treated as a complete resource identity.
- Bridge events use an opaque per-dispatch secret, lease generation, monotonic worker sequence, nonce, and HMAC.
- Duplicate worker events are rejected or replayed by nonce without creating a second effect.
- Mailbox request IDs make retried sends idempotent, while recipient sequence numbers preserve FIFO delivery.
- Acknowledgement requires the exact run, delivery, and recipient address.
- Gate resolution requires an open gate and the configured actor.
- Hosted command output is parsed into bounded DTOs; raw stderr and credentials are not returned.
- Terminal output, mailbox payloads, and event payloads are bounded before persistence or broadcast.

## Residual risks and boundaries

Hosted collaboration mutations remain read-only in this phase. The standalone external control client and complete path-claim enforcement are extension work; current process control stays inside the host orchestration service. No feature should bypass workspace trust, lease checks, explicit gate resolution, or confirmation for destructive actions.
