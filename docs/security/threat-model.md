# Threat Model

## Assets

User files, process execution authority, source-control credentials, provider credentials, conversation data, and approval history are high-value assets.

## Current controls

The renderer has non-privileged shell, diagnostics, and Chat presentation commands. The host owns mode state, SQLite access, operating-system keychain access, provider networking, job cancellation, audit writes, artifact storage, and native notification dispatch. Renderer preview fallback has no authority. Chat starts with no mounted roots; its provider input is built only from active-branch messages and explicitly imported attachments. Chat requests set provider-side response storage to false and disable tools.

## Deferred risks and required controls

| Threat | Required control before enabling capability |
| --- | --- |
| Prompt-induced tool misuse | explicit capability grant, per-action approval, redacted audit log |
| Renderer compromise | host-side authorization and validated typed commands |
| Provider credential exposure | OS secret store, no renderer secret access, redacted diagnostics |
| Terminal/process escape | command policy, workspace scoping, approval tiers, process-tree cleanup |
| Malicious repository content | workspace trust, path normalization, preview isolation |
| Event replay corruption | transactional migrations, idempotency receipts, monotonic sequence checks |
| Interrupted diagnostic work | durable job state and checkpoints, with incomplete work marked `Interrupted` on restart |
| Native notification abuse | renderer permission request only; host persists and dispatches notification content |

## Phase 4 controls verified in code

- Workspace intake canonicalizes the selected directory once and keeps an open `cap-std` directory capability. Relative paths reject absolute/prefix/parent components, and intermediate or target symlinks are not opened or edited.
- Untrusted workspaces expose read/list only. The host checks the trust-derived capability for every write, process, Git, and preview command; the renderer cannot grant itself authority.
- Editor writes use an expected SHA-256 fingerprint, a uniquely named sibling temporary file, `sync_all`, and capability-scoped rename. Concurrent disk edits return a conflict instead of silently overwriting them.
- PTY/ConPTY commands are structured. Shell selection comes from the host environment, the coding-agent adapter is fixed to Codex CLI, output is bounded by the channel contract, and force-stop requests terminate the PTY process group or Windows process tree.
- Preview URLs reject embedded credentials, allow localhost HTTP or explicitly user-entered HTTPS, and open in an auxiliary webview with no renderer capabilities, same-origin navigation filtering, and denied `window.open` children.
- Git integration is read-only in this phase and returns redacted stable errors; no remote credentials, commit mutation, or arbitrary Git argument surface is exposed.

## Phase 3 controls verified in code

- Attachment imports reject symlinks/non-regular files, enforce PDF/image/text byte limits, validate magic/content, hash content, and store under an application-controlled root.
- Export paths are resolved from validated relative paths and archive entry names are reduced to file names, preventing traversal through attachment names.
- Chat event writes and read-model updates occur in the same SQLite transaction. Provider sequence uniqueness suppresses duplicate deltas/completions, while command request IDs guard replayed mutations.
- Context overflow is rejected before the provider request; Chat does not silently trim history or summarize it.
- Provider and secret failures return redacted user-facing diagnostics; credential values are never placed in Chat events or the database.

## Phase 5 controls verified in code

- Orchestration policy is host-owned and durable. The renderer can propose, accept, start, pause, review, and clean up through typed commands but cannot launch a worker or mutate Git directly.
- Dispatches are claimed transactionally with a lease generation. Worker-originated HMAC envelopes include the dispatch, lease, sequence, and nonce; stale or unauthenticated envelopes are rejected.
- Codex workers receive only an application-managed worktree. Worker output and event payloads are bounded, process arguments are structured, and parent workspace/remotes/PR operations are explicitly outside this phase.
- Checkpoints are captured before review. Dependency fan-in is non-interactive and blocks on conflicts; cleanup validates exact confirmation and the managed-root containment invariant.
- Restart recovery marks active orchestration dispatches interrupted while retaining durable worktree and session identifiers. Resumption is an explicit user action with a fresh lease generation.

## Phase 8 controls verified in code

- The updater is host-owned and inert without an explicit endpoint and public key. Configured endpoints are parsed and validated by the updater library; the renderer receives only typed release metadata.
- Backup creation uses SQLite `VACUUM INTO` instead of copying a live database file. The archive contains a versioned manifest, the database, and only application-managed artifacts. Entry count, total size, symlinks, traversal components, and unexpected top-level entries are rejected.
- Restore is staged in private application data and applied before the database pool opens after an explicit restart. Existing SQLite WAL/SHM sidecars and artifact directories are retained as pre-restore copies so an interrupted restore can be diagnosed.
- Startup and clean-shutdown markers distinguish an unexpected exit from a clean close. Active work is recovered as interrupted/reconciliation-required and surfaced in Diagnostics; no ambiguous operation is reported as completed.
- Shell settings persist only visual preferences in renderer local storage. Active mode, window geometry, secrets, jobs, and domain state remain host-owned. The command palette and notification center do not add privileged renderer capabilities.

Security-sensitive implementation requires a new ADR and acceptance test before activation.
