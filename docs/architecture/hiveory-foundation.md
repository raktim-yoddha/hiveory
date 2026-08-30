# Foundation Architecture

## Scope

Phase 8 is the local-first desktop release boundary. Phases 0–1 established the shell, Phase 2 added shared durable infrastructure, Phase 3 added standalone Chat, Phase 4 added the Code workbench, Phase 5 added local Code orchestration, Phase 6 added the Agent vertical slice, and Phase 7 added bounded routines/plugins. Phase 8 closes the shared shell, release, recovery, diagnostics, backup, and update lifecycle around those vertical slices.

The release intentionally targets the useful local subset of the reference products: a single-user desktop host with explicit permissions, durable state, local workspaces, bounded provider access, and reviewable automation. Remote hosts, mobile control, messaging gateways, voice/TTS, computer-use, hosted sync, and arbitrary native extensions are outside this product boundary.

## Runtime shape

The single trusted local renderer is React and TypeScript. It renders state obtained through explicit Tauri commands. The Rust host is the authority for all state that may later affect files, processes, network access, credentials, or approval decisions. A selected workspace mode is presentation state, not permission.

The host exposes namespaced, typed commands for shell state, diagnostics, Chat, and Code. Global, Chat, and terminal-specific Tauri channels carry observations; SQLite remains authoritative for durable metadata and the renderer resumes from persisted sequence cursors.

## Phase 2 shared services

Six boundary crates own the cross-cutting foundation:

- `hiveory-persistence`: SQLite migrations, settings, provider metadata, jobs, checkpoints, audit entries, and in-app notifications.
- `hiveory-secret-store`: operating-system keychain access only; the database stores a secret reference, never the credential.
- `hiveory-model-gateway`: provider adapter boundary. The OpenAI Responses diagnostic stream always sets `store: false` and requires a user-entered model.
- `hiveory-job-runtime`: durable job creation, cancellation tokens, state transitions, checkpoints, and event fan-out.
- `hiveory-tool-runtime`: approval fingerprinting and redacted audit persistence. It has no executable tool adapters in Phase 2.
- `hiveory-notification-service`: persistent in-app notifications and host-mediated native notification requests.

## Phase 3 Chat services

The Chat slice adds two original boundary crates and a host-owned orchestration path:

- `hiveory-chat-domain`: validates turns, estimates context, and owns Chat-specific policy values such as reasoning effort.
- `hiveory-artifact-store`: copies explicitly selected PDF, image, text, and Markdown attachments into an application-controlled content-addressed directory, then produces sanitized ZIP exports.
- `hiveory-persistence::chat`: stores conversations, branches, typed message parts, turns, attachments, drafts, and transactional ordered events. Provider sequence numbers and command request IDs are unique guards against duplicate effects.
- `hiveory-model-gateway`: streams Responses API text/reasoning events with `store: false` and `tools: []`; the host constructs provider input only from active-branch messages and explicitly attached artifacts.

At startup, the host enables SQLite foreign keys and WAL mode, runs migrations, and marks incomplete jobs as `Interrupted`. Diagnostics provides the explicit recovery exercise for that behavior.

## Phase 4 Code services

Code is split into explicit host-side boundaries:

- `hiveory-code-domain`: pure trust capabilities, path validation, language mapping, and deterministic flat pane-tree invariants.
- `hiveory-workspace-service`: canonical workspace intake and `cap-std` directory capabilities for bounded tree reads, UTF-8 editor reads, optimistic-fingerprint saves, symlink rejection, and atomic replacement.
- `hiveory-code-runtime`: native PTY/ConPTY lifecycle, bounded dimensions, base64 terminal channels, process-group/job-tree termination, and the structured Codex CLI adapter probe/launch surface.
- `hiveory-git-service`: read-only Git status and working-tree diff through `git2`; no commits, worktree mutations, remotes, or credentials are exposed in Phase 4.
- `hiveory-persistence::code`: workspace trust, pane layouts, recent documents, terminal summaries, and preview metadata. Terminal bytes are not persisted by default.

Opening a folder creates an `Untrusted` workspace. Only an explicit trust command grants write, process, Git-read, and preview capabilities. The main renderer has no filesystem or shell plugin permissions. Local previews load in a sandboxed docked iframe after host-side credential-free URL validation; the iframe is restricted by the Tauri `frame-src` policy and cannot open new windows through the preview surface.

## Phase 5 Code orchestration

Phase 5 adds `hiveory-code-orchestration` as the transactional owner for Code runs. It consumes the Phase 4 workspace and Git capabilities but is not a Tauri or renderer dependency. The service persists a normalized run/task DAG, claims dispatches with lease generations, schedules only dependency-ready tasks, and publishes bounded per-run events. `hiveory-dispatch-bridge` signs worker-originated envelopes with an ephemeral HMAC secret; the host verifies the envelope before accepting it.

Each worker receives an application-local managed Git worktree. A successful structured Codex execution produces a result checkpoint. Manual review is the default policy; accepted checkpoints unblock dependents, and multiple accepted dependencies are merged through a non-interactive Git fan-in that blocks on conflicts. Cleanup is an explicit, exact-confirmation operation constrained to the managed worktree root. Active dispatches become interrupted during restart recovery while durable worktree and session identifiers remain available for a later retry/resume action.

The Runs surface is a projection of SQLite and the host event stream: it shows the task DAG, worker lanes, lease/checkpoint state, questions, and review decisions. It never receives filesystem paths as capabilities and never launches a process directly.

## Phase 6 Agent services

Agent owns named assistants and their explicit runtime boundary:

- `hiveory-agent-domain`: validates agent definitions, folder grants, tools, skills, memory, artifacts, and bounded child-run requests.
- `hiveory-agent-runtime`: executes a durable run loop with typed tool calls, approval gates, cancellation, checkpointed events, bounded delegation, and restart recovery.
- `hiveory-persistence::agent`: stores agent definitions, grants, skills, memories, artifacts, runs, tool calls, approvals, and ordered events.

The Agent surface can inspect and retry durable runs, enable validated skills, search scoped memory, create artifacts, and delegate bounded work. Folder access is capability-scoped; tool execution remains in the host and every mutating or externally visible action is explicit or approval-gated.

## Phase 7 automation and integrations

Routines and plugins extend Agent without becoming a second authority:

- `hiveory-routine-scheduler` evaluates bounded local schedules, applies catch-up/concurrency policy, and persists execution state.
- `hiveory-plugin-runtime` validates a small manifest/adapter surface, enforces host allow-lists, and keeps connection secrets in the OS-backed secret store.
- Notifications are retained in SQLite and optionally bridged to platform-native delivery after permission.

Routines inherit the selected Agent's grants and limits. Plugins are manifest-defined adapters rather than arbitrary executable modules; the renderer receives summaries and events only.

## Phase 8 release services

Phase 8 adds the final lifecycle controls around the existing domains:

- The shared shell persists active mode, window geometry, accessibility preferences, diagnostics, notifications, and keyboard-driven navigation.
- `hiveory-desktop/src-tauri/src/release.rs` owns bounded portable backup/restore. A backup contains a versioned manifest, a consistent database snapshot, and only application-managed artifacts. Restore validates the archive, retains pre-restore database files, and restarts through a staged pending-restore marker.
- Startup and close markers distinguish a clean shutdown from an interrupted session. Existing active jobs and dispatches remain recoverable through the domain recovery paths.
- The Tauri host owns update configuration, discovery, and installation. No update network request is made until the endpoint and public key are configured at runtime.

The renderer remains a projection of host state in Phase 8. It can request a backup destination, restore source, update check, or update installation, but it never reads the database, opens arbitrary paths, or manages updater keys directly.

## Future boundaries

Remote connection product domains, mobile control, messaging/voice channels, hosted synchronization, arbitrary native plugin execution, and upstream-specific training/datagen/computer-use surfaces remain deferred. They require separate threat models, product contracts, and acceptance tests. Chat remains intentionally isolated from workspace, Git, terminal, and shell capabilities.

One renderer/webview keeps desktop authorization simple. Future browser preview is an auxiliary, capability-free surface rather than a peer authority.

## Design system

The shell and all product modes use a restrained graphite dark palette, blue keyboard focus, green local-host status, flat panels, and compact navigation. Code adds a workspace/file sidebar, visible trust state, deterministic pane-tree summary, Monaco editing, xterm terminal rendering, Git review cards, isolated preview launch, and reduced-motion behavior. Runs adds a dense but readable queue, DAG nodes with dependency labels, worker lanes, checkpoint/review inspection, and explicit action states. Agent adds named-assistant, run, approval, skill, memory, artifact, routine, and plugin cards. Chat adds durable conversation, typed-part, attachment, streaming, retry, branch, and export states. The shared shell adds a keyboard command palette, notification center, settings, recovery indicators, and release actions. The UI uses IBM Plex Sans with JetBrains Mono for source and terminal data. Visual tokens can evolve without changing the security model.
