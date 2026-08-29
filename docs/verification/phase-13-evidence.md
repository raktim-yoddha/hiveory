# Phase 13 verification evidence

## Implemented in this checkout

- Native title-bar minimize, maximize/restore, close, drag separation, and accessible persistent sidebar toggle.
- Local repository summary with remotes, branches, upstream divergence, worktrees, recent commits, and conflict state.
- Hosted repository/issue/pull-request tracking with explicit auth, missing CLI, offline, stale-cache, rate-limit, and error states.
- Workspace-native Source and Coordination panels with no permanent Workbench or Runs navigation.
- Durable addressed mailbox deliveries with FIFO sequence, idempotent request IDs, replay, and acknowledgement.
- Durable decision gates with actor checks and approval/rejection state.
- Worker event routing for progress, question, answer, escalation, and completion messages.
- Additive migrations `0013_source_intelligence.sql`, `0014_orchestration_mailboxes.sql`, and `0015_worker_resources_and_gates.sql`.

## Checks run

The implementation gate for this checkout is:

```text
cargo fmt --all
cargo check -p agentic-super-app-persistence -p agentic-super-app-code-orchestration -p agentic-super-app-app-host
cargo test -p agentic-super-app-persistence -p agentic-super-app-git-service -p agentic-super-app-code-orchestration
pnpm --dir agentic-super-app-renderer check
pnpm --dir agentic-super-app-renderer test
cargo run -p agentic-super-app-tooling
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm audit:identity
pnpm audit:references
git diff --check
```

All commands above passed in the final verification run. The final release build is intentionally not run by this change, so the single release directory is not modified. Before publishing, run the repository release gate and replace the current artifacts in that directory.
