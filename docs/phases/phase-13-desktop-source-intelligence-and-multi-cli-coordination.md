# Phase 13 — Desktop controls, source intelligence, and multi-CLI coordination

## Status

Implemented vertical slice in the current checkout. The desktop controls, source-intelligence surface, durable mailbox, decision-gate storage, worker-event routing, and workspace-native coordination UI are wired and verified. The full standalone external control client, hosted-source mutations, and complete path-claim enforcement remain explicitly bounded follow-up work rather than being represented as complete.

Evidence: `docs/verification/phase-13-evidence.md`.

## Outcome

Code mode becomes a dependable local development control room:

- the frameless Windows controls and sidebar toggle work consistently;
- every registered Git workspace exposes accurate branch, worktree, change, commit, issue, pull-request, review, and check state;
- supported CLI agents can be launched, supervised, addressed, and coordinated through a host-owned control plane;
- runs, tasks, dispatches, workers, mailboxes, completion reports, heartbeats, escalations, questions, replies, decision gates, checkpoints, and recovery are durable;
- parallel workers are isolated by default and cannot silently overwrite one another;
- the fixed workspace tree remains the primary Code-mode navigation surface.

This phase strengthens the existing application. It does not replace the terminal canvas, project/workspace hierarchy, PTY runtime, Git service, or orchestration engine that are already present.

## Non-negotiable constraints

1. Treat every repository under `techn/` as a read-only behavioral reference. Do not edit, build, import, or copy its directory structure into product source.
2. Reimplement behavior in the application's existing Rust/Tauri/React architecture. Reuse source only when its license permits it and preserve required attribution in the existing approved notices file.
3. Do not place reference-product identities in tracked product code, UI copy, tests, comments, filenames, or new documentation. Run both identity audits before completion.
4. Keep the Workspaces section fixed in the left rail. A workspace click opens its canvas. Dashboard remains a global overview and must never act as the workspace canvas.
5. Do not add permanent `Workbench` or `Runs` navigation entries. Source tracking and orchestration are contextual workspace surfaces opened as panes, drawers, or toolbar views.
6. The Rust host owns processes, Git mutations, credentials, persistence, leases, and policy. The renderer only requests typed operations and projects state.
7. No CLI may automate the renderer DOM or inject unbounded keystrokes. Cross-CLI control must use authenticated, typed host commands.
8. A worker may stop only a process resource it owns or has an explicit delegated capability to control. Reused user terminals require an explicit confirmation before destructive actions.
9. Git and GitHub mutations require a trusted workspace and an explicit action. High-impact operations require a confirmation that names the repository, branch, and effect.
10. Secrets remain in the host secret store or the authenticated `gh` session. Never persist access tokens in SQLite, expose them to the renderer, or include them in logs.
11. Preserve backward compatibility for existing projects, workspaces, pane layouts, terminals, and orchestration runs.
12. Build artifacts are published only after all verification gates pass. The release workflow replaces artifacts in the repository's single release directory.

## Current-state findings

### Desktop controls

- The shell already calls the Tauri window API for minimize, maximize/restore, and close.
- The sidebar glyph is currently decorative and has no button, state, or click handler.
- The frameless drag region overlaps the control area closely enough that pointer handling and capability permissions need explicit verification in a packaged build.
- Window-operation failures are swallowed, so a broken permission or runtime call is invisible to the user.

### Source tracking

- The Git service already exposes local status, diff, branch information, worktree management, and checkpoint operations.
- Hosted collaboration is not implemented: there are no issue, pull-request, review, conversation, check-run, or merge-readiness contracts.
- Git state is not presented as one coherent workspace surface.

### Orchestration

- The application already persists runs, tasks, dependencies, dispatches, managed worktrees, checkpoints, reviews, questions, messages, and events.
- Four CLI adapters can already be launched as supervised processes in managed worktrees.
- Heartbeats, cancellation, checkpoint review, recovery, and a worker event bridge already exist.
- The missing layer is a general app-control protocol, addressed durable mailboxes, per-dispatch agent placement, exact worker resource ownership, structured completion reports, decision gates, delivery acknowledgements, conflict claims, and coherent workspace UI.

## Product model

### Project and workspace

- A **project** is a registered repository or folder.
- A **workspace** is the primary checkout or a managed isolated worktree within that project.
- Git and GitHub state belong to the project/repository identity, while working-tree state, panes, terminals, and active dispatches belong to a workspace.

### Run and task

- A **run** is one durable objective within one workspace.
- A **task** is a dependency-aware unit of work in a run.
- A task declares its expected read/write scope, preferred agent, model/effort overrides, review policy, and placement policy.

### Dispatch and worker

- A **dispatch** is one attempt to execute a task.
- A **worker** is the supervised process and terminal resource serving that dispatch.
- A worker may be newly created, adopted from an existing pane, retained after completion, released, abandoned, or stopped.
- Process identity is the tuple of workspace, pane, terminal, session, process incarnation, dispatch, and lease generation. A PID alone is never sufficient identity.

### Participant and mailbox

- A **participant** is a coordinator, dispatch worker, user, or system component with a stable address inside a run.
- Messages are durable and addressed to a participant, dispatch, task, group, or coordinator.
- Deliveries remain unread until acknowledged and can be replayed after restart without duplicating side effects.

### Gate and question

- A **question** asks for information and has an addressed reply.
- A **decision gate** blocks one or more tasks until an allowed actor resolves, rejects, or times it out.
- Questions do not implicitly approve a gate; the two state machines remain separate.

## Target architecture

### 1. Desktop shell control adapter

Keep native window behavior in a small shell adapter rather than spreading Tauri calls through JSX.

Responsibilities:

- minimize, maximize, restore, toggle maximize, close, begin drag, and query maximized state;
- subscribe to resize and focus changes so the maximize/restore icon is truthful;
- return normalized errors to the shell;
- expose a no-op browser-preview implementation for renderer tests;
- persist `sidebarCollapsed` as a local UI preference;
- implement `Ctrl/Cmd+B` and an accessible sidebar toggle with tooltip, `aria-label`, `aria-expanded`, visible focus, and at least a 36 × 36 pixel hit target.

The title bar must reserve a non-drag interaction zone around all buttons. Double-clicking only the empty drag region toggles maximize; clicking an interactive child never starts dragging.

### 2. Source intelligence boundary

Expand `hiveory-git-service` for local repository operations and add a separate hosted-source service for GitHub data. The application protocol remains provider-neutral even though GitHub is the only hosted provider in this phase.

Local Git capabilities:

- repository identity, remotes, upstream, default branch, current branch, detached state;
- branch and worktree lists, current workspace mapping, ahead/behind counts;
- staged, unstaged, untracked, ignored, renamed, and conflicted files;
- file and aggregate diffs, commit log, branch compare, blame-on-demand;
- stage, unstage, discard with confirmation, commit, create/switch/rename/delete branch;
- fetch, pull, push, set upstream, merge, rebase, continue/abort conflict operations;
- stash list/create/apply/drop with confirmations;
- checkpoint and orchestration-worktree integration.

GitHub capabilities:

- authenticate and diagnose through the local `gh` session;
- derive hosted repository identity from HTTPS and SSH remotes, including enterprise hosts;
- list, search, filter, paginate, and inspect issues;
- create/edit/close/reopen issues and add comments, labels, and assignees;
- list and inspect pull requests, including conversation, files, commits, checks, reviews, review threads, draft state, mergeability, and conflicts;
- create a pull request from the current branch and link it to the active workspace/run;
- request reviewers, comment, submit a review, mark files viewed, rerun eligible checks, and update draft state;
- merge or enable auto-merge only through an explicit confirmation gate;
- link branches, worktrees, issues, pull requests, runs, and tasks without making hosted IDs the local primary key.

Hosted data uses stale-while-revalidate caching. Visible items refresh first; background polling is coalesced, cancellable, rate-limit aware, and suspended when the application is not visible. Authentication failures, missing `gh`, offline state, and rate limits must produce actionable UI instead of empty lists.

### 3. Host-owned app control plane

Add an authenticated local IPC server and a bundled command-line client. On Windows, prefer a user-scoped named pipe; use a platform abstraction so Unix-domain sockets can be added without changing protocol contracts.

The host injects scoped connection metadata into terminals it creates:

- control endpoint identifier;
- opaque capability token;
- application instance, project, workspace, pane, and terminal IDs;
- optional run, task, dispatch, participant, and lease IDs.

The token is short-lived, revocable, bound to a process incarnation, and grants only named capabilities. It is never printed by the client.

Initial typed commands:

- `app status`, `workspace list/show/open`, `pane list/focus/create/split/move/close`;
- `terminal list/read/send/wait/resize/stop`;
- `worker start/show/read/stop/abandon/retain/release/list`;
- `run create/use/current/list/show/start/pause/cancel`;
- `task create/list/show/update/link/claim/release`;
- `dispatch list/show/retry/cancel`;
- `message send/reply/check/inbox/wait/ack`;
- `question ask/reply/list`;
- `gate create/resolve/list`;
- `source status/issues/pulls/checks/refresh` for read-only context.

Every mutation includes a client request ID. The host stores a mutation receipt and returns the original result when the same request is replayed. Payload size, read range, wait duration, and output volume are bounded.

### 4. Durable orchestration core

Refactor the existing orchestration crate into focused modules while preserving its public behavior:

- run lifecycle and coordinator binding;
- task DAG, readiness, ownership, and file claims;
- dispatch scheduling, retry policy, and circuit breakers;
- worker lifecycle and terminal resource accounting;
- addressed mailboxes, delivery, acknowledgement, replay, and threads;
- heartbeats, liveness, escalation, and recovery;
- questions, replies, decision gates, and timeouts;
- checkpoints, reviews, fan-in, merge readiness, and cleanup;
- event audit, idempotency, and compatibility projection.

Required orchestration behavior:

- One visible CLI can become the coordinator for a run.
- The coordinator can start another supported CLI in a new pane or dispatch to an eligible existing pane.
- Agent, model, effort, workspace placement, and terminal policy can be selected per dispatch rather than only per run.
- A coordinator can send assignments, status requests, questions, replies, escalations, and cancellation requests through durable messages.
- Workers publish heartbeats and structured progress without flooding the event log.
- Completion is a structured report containing outcome, summary, files changed, checkpoint, tests, warnings, remaining work, and optional report artifact.
- The scheduler reconciles the completion report with the process exit and repository state before completing the task.
- Missing heartbeats move a worker to suspect, then stale. Retry/stop decisions use lease generations so late workers are fenced.
- Repeated failures trip a per-task circuit breaker and escalate instead of spawning forever.
- Decision gates can block a task, dispatch, merge, Git mutation, or destructive process action.
- Mailbox delivery is FIFO per recipient and durable until acknowledged. Waiting supports a bounded timeout and keepalive.
- Coordinator questions and worker questions survive restart and retain reply identity.
- A worker can be retained for follow-up, released cleanly, or abandoned without losing its output archive.
- Recovery restores run state, reattaches live resources when identities match, archives output when they do not, and never treats a recycled PID as the original worker.

### 5. Conflict prevention

Parallel work uses defense in depth:

1. Managed worktrees isolate write-capable tasks by default.
2. The task DAG prevents dependants from dispatching early.
3. Tasks declare expected read and write paths; the host records renewable claims.
4. Overlapping write claims block or require coordinator approval.
5. Before completion, the host compares actual changed paths with declared claims.
6. Fan-in uses checkpoints and a clean integration workspace, never blind file copying.
7. Merge conflicts create an escalation and gate rather than an automatic overwrite.
8. Stale leases and duplicate completion events are rejected but retained in the audit log.

The system should prevent avoidable conflicts, report unavoidable conflicts precisely, and preserve recoverable work.

### 6. Workspace UI

Keep the visual language compact, dark, and terminal-first. Add contextual surfaces without another global navigation stack.

#### Fixed rail

- Preserve Dashboard, Routines, Plugins, Skills, and Workspaces.
- Make the title-bar sidebar button collapse/expand this rail without changing the selected global section or workspace.
- Keep project/workspace expansion, selection, badges, and status after collapse and restart.
- Add subtle badges for dirty state, current branch, open pull request, failing checks, active workers, waiting questions, and unresolved gates.

#### Source pane or drawer

Provide tabs for:

- Changes;
- Branches and worktrees;
- Commits and compare;
- Issues;
- Pull requests;
- Checks and reviews.

Each tab needs loading, empty, offline, unauthenticated, stale, partial, error, and success states. Mutations use optimistic feedback only when a rollback path exists.

#### Coordination pane or drawer

Evolve the existing run screen into a workspace-native coordination surface:

- run selector and create/resume controls;
- task DAG and readiness reasons;
- worker topology with CLI, model, pane, worktree, heartbeat, lease, and current task;
- dispatch inspector and live bounded output;
- threaded inbox with unread counts and acknowledgements;
- completion report viewer;
- escalation and question queue;
- decision-gate queue with allowed actions and timeout;
- checkpoint diff, review, and fan-in status;
- exact stop, retry, retain, release, and open-pane actions.

The canvas remains usable while these surfaces are open. Drawers must be resizable and keyboard reachable. Pane focus, source selection, and orchestration selection must not overwrite one another.

## Protocol additions

Add versioned DTOs and commands in `hiveory-protocol` for:

- local repository summary, remote, branch, worktree, change, diff, commit, compare, conflict, and operation result;
- hosted repository, issue, pull request, check, review, comment, pagination cursor, sync state, rate limit, and auth diagnostic;
- participant, address, message thread, message priority, delivery, acknowledgement, and wait result;
- worker resource, ownership, process incarnation, capability set, output cursor, archive, and release state;
- completion report, task path claim, escalation, decision gate, gate resolution, mutation receipt, and recovery diagnostic;
- control-plane request/response envelopes with protocol version and request ID.

Compatibility rules:

- Existing run details remain readable.
- New optional fields receive safe defaults when decoding prior rows.
- Generated TypeScript bindings are the renderer's only source of DTO truth.
- Commands return structured error codes plus safe user messages; string parsing is forbidden.

## Persistence migrations

Create additive, restart-safe migrations after `0012_code_projects.sql`.

### `0013_source_intelligence.sql`

- hosted repository identity and remote mapping;
- issue and pull-request cache records;
- checks, reviews, conversations, labels, and assignee cache records;
- sync cursors, ETags where available, refresh state, and rate-limit state;
- workspace links to branch, issue, pull request, and last viewed item.

### `0014_orchestration_mailboxes.sql`

- participants and stable addresses;
- message threads and expanded messages;
- per-recipient deliveries, read/ack state, delivery sequence, and replay cursor;
- coordinator and worker inbox preferences;
- idempotent mutation receipts.

### `0015_worker_resources_and_gates.sql`

- supervised worker resources and exact process incarnation identity;
- terminal ownership, adoption, retention, release, and output archive state;
- per-dispatch adapter/model/effort/placement overrides;
- structured completion reports;
- questions with addressed replies;
- decision gates and resolutions;
- task path claims and conflict records;
- escalation state and circuit-breaker counters.

Each migration needs round-trip repository tests, indexes for every polling path, foreign-key enforcement, bounded cleanup, and fixtures proving old databases upgrade without losing state.

## Implementation workstreams

### Workstream A — Contracts and safety baseline

1. Inventory current Tauri permissions, shell event boundaries, Git operations, orchestration commands, schema constraints, and generated bindings.
2. Write state-transition tables for workers, deliveries, gates, source sync, and Git mutations.
3. Add threat-model tests for capability leakage, stale leases, wrong-process termination, untrusted workspace mutation, path escape, and token logging.
4. Record a behavior-to-target mapping from the local reference under `techn/` without importing reference names or structure into product code.

Gate: protocol review, schema review, and threat-model review pass before migrations or process-control work begins.

### Workstream B — Window controls and sidebar toggle

1. Extract the shell window adapter.
2. Make minimize, maximize/restore, close, title-bar drag, and double-click behavior deterministic.
3. Add only the least-privilege Tauri window capabilities required by the chosen API calls.
4. Replace the decorative sidebar glyph with a real accessible button.
5. Add persistent collapse state, keyboard shortcut, responsive content sizing, and renderer behavior tests.
6. Verify interactions in both development and the packaged Windows application.

Gate: every attached control works with mouse and keyboard, maximize state is accurate, and the sidebar state survives restart.

### Workstream C — Local Git vertical slice

1. Introduce source-intelligence protocol records and host command modules.
2. Expand the Git service with repository summary, branches, worktrees, changes, commits, compare, and guarded mutations.
3. Add a Source pane with Changes and Branches tabs.
4. Connect workspace rail badges to one deduplicated repository status subscription.
5. Test with clean, dirty, detached, conflicted, no-remote, multiple-worktree, and large repositories.

Gate: branch and change tracking is accurate and mutations cannot run in an untrusted workspace.

### Workstream D — GitHub vertical slice

1. Add the hosted-source service and `gh` authentication diagnostics.
2. Implement repository identity, issue list/detail, pull-request list/detail, checks, reviews, and refresh scheduling.
3. Add Issues, Pull Requests, and Checks tabs with pagination and stale/offline states.
4. Add guarded issue/PR/comment/review actions, then merge and auto-merge last.
5. Add cache migration and rate-limit/backoff tests using deterministic fixtures.

Gate: one authenticated test repository can be tracked end to end without exposing credentials or blocking the UI.

### Workstream E — App control plane vertical slice

1. Add the local IPC server, capability issuer, protocol envelopes, audit events, and bundled client.
2. Inject scoped control metadata into host-created terminal and CLI processes.
3. Implement read-only status/list commands first.
4. Add pane creation/focus and worker start/show/read.
5. Add guarded send/stop/release commands with exact resource checks and idempotency receipts.
6. Test malformed messages, revoked capabilities, replayed requests, stale processes, and application restart.

Gate: a supported CLI in one pane can create a second supported CLI pane, inspect its exact status, and send it a bounded task through the host protocol.

### Workstream F — Durable mailboxes and worker supervision

1. Apply mailbox and worker-resource migrations.
2. Add participant addressing, durable delivery, acknowledgement, replay, reply threading, and bounded waits.
3. Add per-dispatch adapter/model/effort/placement.
4. Add structured completion reports and output archives.
5. Add retain/release/abandon semantics and exact process fencing.
6. Surface messages, worker state, and completion reports in the Coordination pane.

Gate: two different CLI workers and one coordinator can exchange durable messages, restart the app, and continue without duplicate task effects.

### Workstream G — Gates, escalation, conflict control, and convergence

1. Implement decision-gate state and allowed-actor resolution.
2. Implement heartbeat suspicion/stale thresholds and escalation routing.
3. Implement task path claims, overlap detection, and coordinator decisions.
4. Add retries, backoff, circuit breakers, and dead-worker reconciliation.
5. Connect checkpoints to clean fan-in and conflict escalation.
6. Add gate, escalation, question, and conflict queues to the Coordination pane.

Gate: concurrent non-overlapping tasks complete automatically; overlapping tasks are blocked or explicitly approved; merge conflicts never overwrite user work.

### Workstream H — UX integration and performance

1. Finish all source and coordination states, keyboard paths, tooltips, focus restoration, and accessible announcements.
2. Add virtualized lists for large issue, PR, commit, event, message, and output collections.
3. Coalesce host subscriptions and cancel stale requests on workspace switch.
4. Preserve workspace selection, pane layout, source tab, drawer width, and run selection independently.
5. Remove obsolete contextual navigation and dead code only after behavior parity tests pass.

Gate: no global navigation regression, no unexpected page scrollbar, no workspace-tree disappearance, and no measurable typing or terminal-resize regression under active background sync.

### Workstream I — Recovery, documentation, and release

1. Test crash/restart during Git refresh, active dispatch, mailbox delivery, question, gate, and fan-in.
2. Verify old database migration and terminal-layout recovery.
3. Publish architecture records for source intelligence, app control, orchestration lifecycle, protocol/security, and recovery.
4. Update this phase document from planned to delivered with factual evidence.
5. Update contributor documentation and changelog without including restricted reference identities.
6. Run the complete verification matrix and replace artifacts in the single release directory.

Gate: all automated suites, identity audits, packaged-app checks, and recovery scenarios pass.

## Primary implementation map

Expected existing areas to change:

- `hiveory-renderer/src/hiveory-shell.tsx`
- `hiveory-renderer/src/styles.css`
- `hiveory-renderer/src/code-workspace/`
- `hiveory-renderer/src/code/hiveory-code-runs.tsx`
- `hiveory-desktop/src-tauri/capabilities/default.json`
- `hiveory-desktop/src-tauri/src/`
- `hiveory-crates/hiveory-protocol/`
- `hiveory-crates/hiveory-persistence/`
- `hiveory-crates/hiveory-git-service/`
- `hiveory-crates/hiveory-code-runtime/`
- `hiveory-crates/hiveory-code-orchestration/`
- `hiveory-crates/hiveory-dispatch-bridge/`
- `hiveory-tooling/`

Expected new cohesive areas:

- `hiveory-crates/hiveory-hosted-source-service/`
- `hiveory-crates/hiveory-control-plane/`
- `hiveory-renderer/src/source-control/`
- `hiveory-renderer/src/orchestration/`
- `docs/architecture/source-intelligence.md`
- `docs/architecture/app-control-plane.md`
- `docs/architecture/code-orchestration.md`
- `docs/architecture/code-orchestration-threat-model.md`
- `docs/verification/phase-13-evidence.md`

The implementation agent may adjust filenames after inspecting module boundaries, but must preserve the service separation and acceptance behavior in this plan.

## Test matrix

### Desktop and UI

- mouse and keyboard tests for minimize, maximize/restore, close, drag, double-click, and sidebar toggle;
- sidebar persistence and content-width tests at minimum window size and common desktop sizes;
- no workspace/navigation regression across Dashboard, Routines, Plugins, Skills, and workspace canvases;
- behavior-driven renderer tests for source and coordination drawers;
- accessible names, visible focus, focus restoration, and `aria-live` error/status announcements.

### Git and GitHub

- temporary repositories covering clean, dirty, renamed, untracked, conflicted, detached, no-upstream, ahead, behind, and multiple-worktree states;
- guarded stage/commit/branch/fetch/pull/push/merge/rebase/stash operations;
- remote parsing for HTTPS, SSH, forks, and enterprise hosts;
- deterministic issue/PR/check/review fixtures, pagination, cache refresh, offline fallback, auth loss, and rate limiting;
- mutation idempotency and confirmation behavior.

### Control plane and orchestration

- capability scope, expiration, revocation, replay, request size, output bounds, and exact-resource targeting;
- create/adopt/read/send/stop/retain/release worker lifecycle;
- coordinator plus at least three heterogeneous workers;
- addressed FIFO delivery, reply threads, unread/peek/ack/wait, crash before acknowledgement, and replay after restart;
- per-dispatch adapter/model/effort and workspace placement;
- heartbeat loss, late heartbeat, stale lease, PID reuse, cancellation race, duplicate completion, failed completion report, and output archive;
- question/reply, gate approve/reject/timeout, escalation, retry, circuit breaker, and cleanup;
- overlapping path claims, conflicting checkpoints, clean fan-in, merge conflict, and preserved user changes.

### Performance and reliability

- terminal typing and resize remain responsive with GitHub sync and orchestration events active;
- event/message/output lists remain responsive at realistic high counts;
- refresh operations are deduplicated across panes;
- startup and recovery time remain bounded with historical runs and cached hosted data;
- no unbounded process, timer, subscription, database, or log growth.

## Completion criteria

Phase 13 is complete only when all statements below are true:

1. The minimize, maximize/restore, close, and sidebar buttons work in the packaged Windows app and renderer tests.
2. Sidebar collapse is accessible, persistent, and does not change the selected workspace or global section.
3. The selected repository shows accurate branches, worktrees, changes, commits, issues, pull requests, reviews, and checks.
4. GitHub auth, offline, stale, rate-limit, and error states are explicit and recoverable.
5. A supported CLI can use the control client to open another supported CLI pane, assign work, inspect status/output, exchange messages, and request an exact stop.
6. Runs, tasks, dispatches, supervised workers, messages, completion reports, heartbeats, escalations, questions/replies, and gates survive application restart.
7. Per-dispatch agent choice and placement work across all four supported CLI adapters.
8. Concurrent workers cannot silently overwrite overlapping work, and fan-in preserves recoverable changes.
9. Stale or replayed workers cannot mutate current run state.
10. No credential, capability token, or sensitive terminal output leaks into renderer state, SQLite, logs, or documentation.
11. Existing projects, workspaces, pane layouts, terminals, and old orchestration runs migrate without data loss.
12. The fixed workspace rail remains present across all global sections, and no replacement navigation is introduced.
13. Identity/reference audits, Rust tests, renderer tests, checks, packaged smoke tests, and recovery tests pass.
14. Only the latest portable and installer artifacts remain in the single release directory.

## Verification commands

The exact package-level commands may expand as new crates are added, but the final gate must include:

~~~powershell
pnpm --dir hiveory-renderer test
pnpm --dir hiveory-renderer check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check -p hiveory-app-host
pnpm audit:identity
pnpm audit:references
pnpm verify
~~~

The packaged-app smoke test and release replacement command must run only after these checks pass.

## Explicit deferrals

The following are not required to complete this phase:

- additional hosted forge providers beyond GitHub;
- remote-host federation or cloud worker scheduling;
- mobile process control;
- arbitrary third-party terminal automation outside the typed control protocol;
- autonomous merge of unresolved conflicts;
- bypassing provider authentication, repository protection rules, or user confirmation.

These boundaries keep the phase local-first and shippable while leaving versioned extension points for later work.
