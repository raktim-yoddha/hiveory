# ADR 0014: Phase 5 Code Orchestration

## Context

Code mode needs a durable, reviewable way to coordinate multiple implementation tasks without giving the renderer ownership of processes, Git state, or execution policy. A run must survive renderer reloads and host restarts while preventing stale worker output from changing current state.

## Decision

Add a host-owned orchestration service with a SQLite-backed run, task, dependency, dispatch, worktree, checkpoint, review, question, message, and event model. SQLite is authoritative; the renderer receives projections and reconnects from a per-run event cursor.

Manual tasks and read-only structured Codex DAG proposals use the same acceptance path. A proposal is never executed automatically. The scheduler computes a deterministic ready set and applies an adaptive host cap, with a default run concurrency of two. Each dispatch receives a managed Git worktree under application local data and a lease generation. Restart marks active dispatches interrupted while retaining worktree and session identifiers; retry or explicit resume creates a new lease.

Workers launch through structured `codex exec --json` or `codex exec resume` arguments. Worker output is bounded and summarized. Successful work is captured as a Git checkpoint; manual review can accept, request changes, or reject it. Completed dependency checkpoints are fanned in with `git2`; conflicts block the dependent task and never open an interactive conflict editor in this phase. Cleanup requires an exact confirmation and stays within the managed worktree root.

Worker event envelopes use an ephemeral per-dispatch HMAC secret, a nonce, lease generation, and sequence. The secret is passed only to the worker boundary and is not persisted. General Git CRUD, remotes, pull requests, and conflict editing remain deferred.

## Consequences

Phase 5 supports a real local DAG lifecycle from planning through isolated worker execution, checkpoint review, dependency fan-in, recovery, and cleanup. The host has one transaction and policy owner, while the renderer can render Runs and Workbench projections without filesystem or process authority. The browser preview uses a deterministic in-memory run simulator so the UI remains inspectable without a local Codex installation.

## Verification

The domain tests cover deterministic DAG ordering, dependency readiness, text bounds, and adaptive concurrency. Orchestration tests cover authenticated worker events and structured worker output parsing. Git tests cover worktree/checkpoint primitives. Required gates include generated TypeScript bindings, Rust workspace tests, renderer lint/typecheck/build, and reference/prohibited-name audits.
