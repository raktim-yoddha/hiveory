# Threat model

This threat model covers the current Hiveory `0.2.1` desktop application. Security reports follow the private process in the root [security policy](../../SECURITY.md).

## Assets and trust boundaries

High-value assets include user files and repositories, process execution authority, source-control credentials, provider credentials, conversation and attachment data, plugin connections, approval history, automation schedules, and durable run state.

The main boundaries are:

1. **Renderer to Rust host.** Renderer input is untrusted. The host validates typed command envelopes and enforces capability policy.
2. **Host to local filesystem and processes.** Roots, paths, executables, arguments, environment, process ownership, and lifecycle are host-controlled.
3. **Host to provider networks.** Model, plugin, Jira, and Linear requests use configured HTTPS endpoints and user-owned credentials. GitHub collaboration uses a locally authenticated `gh` process.
4. **Host to durable storage.** SQLite stores metadata and state; secrets resolve through the operating-system credential store.
5. **Main renderer to native browser/preview surfaces.** Child webviews receive no privileged renderer commands and are constrained by origin and window policy.

## Core controls

| Threat | Current control |
| --- | --- |
| Renderer compromise | Privileged state and authorization remain in Rust; commands and payloads are validated again at the host boundary |
| Path traversal or symlink escape | Workspace roots are canonicalized; absolute, prefixed, parent-traversal, and symlinked targets are rejected before capability-scoped access |
| Unauthorized writes or process launches | Workspaces start untrusted; explicit trust derives separate read, write, process, Git, and preview capabilities |
| Credential disclosure | Secret values use the OS credential manager; renderer projections contain connection state and opaque references; errors and diagnostics are redacted |
| Prompt-induced tool misuse | Agent and automation tools require explicit grants; mutating or externally visible calls follow approval policy and create durable audit records |
| Plugin network escape | Declarative manifests use HTTPS host allow-lists, bounded schemas, timeouts, response limits, and distinct risk for read and write operations |
| Arbitrary command injection | Shell and worker launches use an executable plus argument vector, fixed adapter selection, scoped working directory, bounded environment, and process ownership |
| Stale or replayed mutations | Request IDs, unique constraints, optimistic revisions, monotonic event sequences, nonces, and dispatch lease generations fence duplicate and stale effects |
| Malicious or oversized content | Attachments, archives, terminal chunks, plugin payloads, provider responses, logs, and event backlogs have type and size limits |
| Browser privilege escalation | Browser and preview panes are auxiliary native webviews with no Tauri capability grant; navigation and child-window behavior are host-controlled |
| Interrupted work reported as complete | Startup recovery marks ambiguous jobs, chats, terminals, agent runs, and dispatches interrupted or reconciliation-required |

## Workspace, terminal, and Git controls

- The workspace service retains a capability-scoped directory handle. Editor saves require the expected SHA-256 fingerprint and use a sibling temporary file, `sync_all`, and atomic rename.
- PTY/ConPTY sessions are host-owned and have stable IDs, bounded dimensions, a bounded ring buffer, monotonic output sequences, and process-tree termination. Missing live state is surfaced as recoverable or ended rather than rendered as an empty successful terminal.
- Pane topology is a versioned, host-validated tree. Revision conflicts cause a reload instead of merging stale renderer state.
- Git roots come from validated workspace state. Repository and hosted-source operations use fixed host functions rather than arbitrary Git or CLI argument surfaces.
- Managed worktrees stay below the application-managed root. Cleanup validates containment and exact user intent before removing a worktree.

## Agent, Chat, plugin, and automation controls

- Chat starts with no mounted workspace. Provider input contains only active-branch messages, explicitly imported attachments, and the selected profile instructions. The host exposes selected valid skills, validated plugin tools, and bounded read-only folder tools through a per-session bridge; it never inherits Code workspace, terminal, or Git capabilities.
- Attachment imports reject links and non-regular files, validate supported content, enforce byte limits, and copy data into a content-addressed managed root. Portable export sanitizes archive names.
- Agent folder, skill, tool, and plugin access is explicit. Approval decisions are bound to the action fingerprint; changed actions require a new decision.
- Plugin credentials are resolved only for the selected connection. Host allow-lists prevent a manifest from redirecting a request to another service.
- Automations inherit the selected agent's grants and limits. Catch-up, concurrency, duration, tool-call, and approval-timeout policy bound unattended execution.
- The local board never turns a drag operation into an external Jira, Linear, or GitHub workflow mutation.

## Orchestration controls

- Task graphs and scheduler policy are durable and host-owned. A proposed graph requires explicit acceptance.
- Dispatches use generation leases. Worker bridge envelopes include the dispatch, generation, sequence, nonce, and HMAC; stale or unauthenticated events are rejected.
- Questions, checkpoints, reviews, participant mailboxes, completion reports, path claims, and decision gates remain attached to one run and workspace.
- Dependency fan-in is non-interactive and stops on conflict. Checkpoints exist before review changes dependency readiness.
- Restart retains durable worktree and session identifiers while requiring a fresh lease for retry or resume.

## Release, backup, and update controls

- Backup uses SQLite `VACUUM INTO` for a consistent snapshot and includes only a versioned manifest plus application-managed artifacts.
- Restore rejects traversal, links, unexpected top-level entries, excessive entry counts, and excessive uncompressed size. It is staged before the normal database pool opens and retains pre-restore files.
- The updater makes no request without an explicitly configured HTTPS endpoint and public key. Tauri verifies the signed package before installation.
- Startup and clean-shutdown markers distinguish a normal exit from a crash; diagnostics exposes recovery status without revealing secrets or unrestricted host state.

## Current limitations

Hiveory is a single-user local desktop trust model. It does not provide multi-tenant isolation, a remote execution host, a shared OAuth broker, arbitrary native plugin sandboxing, or hosted synchronization. Provider accounts remain subject to each provider's token scope and revocation controls. Local malware running as the same operating-system user is outside the protection offered by the application credential store.

Security-sensitive boundary changes require an ADR, tests at the enforcing Rust layer, and an update to this document.
