# Foundation Architecture

## Scope

Phase 0–1 established the shell, Phase 2 added shared durable infrastructure, Phase 3 added standalone Chat, Phase 4 added the first Code vertical slice, and Phase 5 adds local Code orchestration. Remote workspaces and broader Agent product surfaces remain separate future domains.

## Runtime shape

The single trusted local renderer is React and TypeScript. It renders state obtained through explicit Tauri commands. The Rust host is the authority for all state that may later affect files, processes, network access, credentials, or approval decisions. A selected workspace mode is presentation state, not permission.

The host exposes namespaced, typed commands for shell state, diagnostics, Chat, and Code. Global, Chat, and terminal-specific Tauri channels carry observations; SQLite remains authoritative for durable metadata and the renderer resumes from persisted sequence cursors.

## Phase 2 shared services

Six boundary crates own the cross-cutting foundation:

- `agentic-super-app-persistence`: SQLite migrations, settings, provider metadata, jobs, checkpoints, audit entries, and in-app notifications.
- `agentic-super-app-secret-store`: operating-system keychain access only; the database stores a secret reference, never the credential.
- `agentic-super-app-model-gateway`: provider adapter boundary. The OpenAI Responses diagnostic stream always sets `store: false` and requires a user-entered model.
- `agentic-super-app-job-runtime`: durable job creation, cancellation tokens, state transitions, checkpoints, and event fan-out.
- `agentic-super-app-tool-runtime`: approval fingerprinting and redacted audit persistence. It has no executable tool adapters in Phase 2.
- `agentic-super-app-notification-service`: persistent in-app notifications and host-mediated native notification requests.

## Phase 3 Chat services

The Chat slice adds two original boundary crates and a host-owned orchestration path:

- `agentic-super-app-chat-domain`: validates turns, estimates context, and owns Chat-specific policy values such as reasoning effort.
- `agentic-super-app-artifact-store`: copies explicitly selected PDF, image, text, and Markdown attachments into an application-controlled content-addressed directory, then produces sanitized ZIP exports.
- `agentic-super-app-persistence::chat`: stores conversations, branches, typed message parts, turns, attachments, drafts, and transactional ordered events. Provider sequence numbers and command request IDs are unique guards against duplicate effects.
- `agentic-super-app-model-gateway`: streams Responses API text/reasoning events with `store: false` and `tools: []`; the host constructs provider input only from active-branch messages and explicitly attached artifacts.

At startup, the host enables SQLite foreign keys and WAL mode, runs migrations, and marks incomplete jobs as `Interrupted`. Diagnostics provides the explicit recovery exercise for that behavior.

## Phase 4 Code services

Code is split into explicit host-side boundaries:

- `agentic-super-app-code-domain`: pure trust capabilities, path validation, language mapping, and deterministic flat pane-tree invariants.
- `agentic-super-app-workspace-service`: canonical workspace intake and `cap-std` directory capabilities for bounded tree reads, UTF-8 editor reads, optimistic-fingerprint saves, symlink rejection, and atomic replacement.
- `agentic-super-app-code-runtime`: native PTY/ConPTY lifecycle, bounded dimensions, base64 terminal channels, process-group/job-tree termination, and the structured Codex CLI adapter probe/launch surface.
- `agentic-super-app-git-service`: read-only Git status and working-tree diff through `git2`; no commits, worktree mutations, remotes, or credentials are exposed in Phase 4.
- `agentic-super-app-persistence::code`: workspace trust, pane layouts, recent documents, terminal summaries, and preview metadata. Terminal bytes are not persisted by default.

Opening a folder creates an `Untrusted` workspace. Only an explicit trust command grants write, process, Git-read, and preview capabilities. The main renderer has no filesystem or shell plugin permissions. Local previews use a separate capability-free auxiliary webview with credential-free URL validation and same-origin navigation filtering.

## Phase 5 Code orchestration

Phase 5 adds `agentic-super-app-code-orchestration` as the transactional owner for Code runs. It consumes the Phase 4 workspace and Git capabilities but is not a Tauri or renderer dependency. The service persists a normalized run/task DAG, claims dispatches with lease generations, schedules only dependency-ready tasks, and publishes bounded per-run events. `agentic-super-app-dispatch-bridge` signs worker-originated envelopes with an ephemeral HMAC secret; the host verifies the envelope before accepting it.

Each worker receives an application-local managed Git worktree. A successful structured Codex execution produces a result checkpoint. Manual review is the default policy; accepted checkpoints unblock dependents, and multiple accepted dependencies are merged through a non-interactive Git fan-in that blocks on conflicts. Cleanup is an explicit, exact-confirmation operation constrained to the managed worktree root. Active dispatches become interrupted during restart recovery while durable worktree and session identifiers remain available for a later retry/resume action.

The Runs surface is a projection of SQLite and the host event stream: it shows the task DAG, worker lanes, lease/checkpoint state, questions, and review decisions. It never receives filesystem paths as capabilities and never launches a process directly.

## Future boundaries

Agent orchestration and remote connection product-domain crates remain deferred until their parity features have owners and acceptance tests. Chat remains intentionally isolated from workspace, Git, terminal, and shell capabilities.

One renderer/webview keeps desktop authorization simple. Future browser preview is an auxiliary, capability-free surface rather than a peer authority.

## Design system

The shell, Phase 3 Chat, Phase 4 Code, and Phase 5 Runs use a restrained graphite dark palette, blue keyboard focus, green local-host status, flat panels, and compact navigation. Code adds a workspace/file sidebar, visible trust state, deterministic pane-tree summary, Monaco editing, xterm terminal rendering, Git review cards, isolated preview launch, and reduced-motion behavior. Runs adds a dense but readable queue, DAG nodes with dependency labels, worker lanes, checkpoint/review inspection, and explicit action states. The UI uses IBM Plex Sans with JetBrains Mono for source and terminal data. Visual tokens can evolve without changing the security model.
