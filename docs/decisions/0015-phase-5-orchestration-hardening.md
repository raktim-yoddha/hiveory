# ADR 0015: Phase 5 Orchestration Hardening

## Context

The first Phase 5 vertical slice established the run, task, dispatch,
worktree, checkpoint, review, and event model. Its remaining risks were at
the boundaries: concurrent event writers could allocate the same cursor,
worker output could outlive a cancelled lease, and the renderer had no safe
way to resume an interrupted dispatch or attach a terminal to its managed
worktree.

## Decision

Migration `0006_code_orchestration_hardening.sql` adds explicit coordinator
and adapter identity, a per-run event sequence allocator, worker origin and
sequence metadata, nonce replay protection, terminal linkage, and durable
cancellation timestamps. Event insertion increments the run allocator inside
the same SQLite transaction as the event insert; a nonce replay returns the
original event without broadcasting a second copy.

The orchestration service uses a `CodeWorkerAdapter` boundary with the local
Codex CLI implementation selected by the `codex-cli` adapter ID. Each worker
gets a random ephemeral HMAC secret, bounded line-oriented stdout handling,
heartbeat updates, a cancellation token, and host-side process-tree
termination. Workers inherit an explicit runtime/configuration environment
allowlist; dispatch secrets and bridge variables are injected only after that
allowlist is applied. Background workers use the explicit approval policy only
after the user has started the run and are confined to their managed worktree.
A cancellation or lease change fences completion before a Git checkpoint is
accepted. Stale running leases are marked stale after twenty seconds without a
heartbeat.

Interrupted dispatches retain their managed worktree and session ID and can
be resumed only with the current lease generation. Dispatch terminals are
opened from a host-validated managed worktree path; the renderer never sends
an arbitrary directory to the PTY runtime. Reviewers can inspect a checkpoint
diff before accepting, requesting changes, or rejecting a result.

## Consequences

Phase 5 now has explicit durable lifecycle controls for restart, replay,
pause, cancellation, resume, review, and terminal inspection. The browser
preview mirrors the public lifecycle shape, while SQLite remains the source
of truth for the desktop host. Adapter discovery, named agents, remote
execution, remotes, pull requests, and main-branch merges remain out of
scope for this phase.

## Verification

The required gates are `cargo fmt --all --check`, `cargo clippy --workspace
--all-targets --all-features -- -D warnings`, `cargo test --workspace`,
renderer tests/checks, generated TypeScript bindings, and the repository
identity/reference audits. Focused coverage includes atomic event cursors,
nonce replay behavior, lease-aware cancellation/resume, bounded worker
streams, and host-validated terminal roots.
