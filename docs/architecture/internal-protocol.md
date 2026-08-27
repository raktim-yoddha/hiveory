# Internal Protocol v2

All renderer-to-host requests use original `agentic_super_app_*` command names. DTOs are owned by `agentic-super-app-protocol` and exported to TypeScript through `agentic-super-app-tooling`.

| Contract | Rule |
| --- | --- |
| Versioning | `ProtocolVersion.major` must match before a command is processed. This release uses major `2`; breaking changes increment it. |
| IDs | Future durable IDs use UUIDv7 strings; renderer input is untrusted. |
| Commands | `CommandEnvelope<T>` carries protocol, request ID, and payload. |
| Replies | `ResponseEnvelope<T>` echoes request ID and protocol. |
| Errors | `ApiError` has stable code, human message, retry class, and optional recovery action. |
| Streams | Shared and Chat streams use Tauri channels. Chat events include global and aggregate sequence numbers; the renderer reconnects from the last confirmed cursor and can query a bounded persisted backlog. |
| Chat commands | Chat mutations carry the same request ID through host validation and durable conversation/branch/turn uniqueness guards. Replaying a start, retry, edit, create, or branch command does not create a second effect. |
| Chat parts | `ChatMessagePart` is a tagged union for text, reasoning summary, status, error, attachment, image, citation, usage, and reserved tool call/result records. Ordinary Chat emits no tools. |
| Code commands | Code mutations use the same envelope and request-ID shape. Workspace open starts untrusted; trust is explicit and host-checked before saves, process launches, Git reads, or preview opens. |
| Code paths | File and Git paths are relative, normalized, and checked for parent traversal, prefixes, and symlink components before capability-scoped directory operations. |
| Code streams | PTY/ConPTY output is emitted as bounded base64 chunks over a per-terminal Tauri channel. Terminal bytes are not written to SQLite; summaries and exit state are durable. |
| Code layouts | Pane layouts are versioned flat trees with stable IDs, parent/child consistency, a single reachable root, and bounded split ratios. Invalid persisted layouts fall back to the deterministic default. |
| Code orchestration | Runs, tasks, dependencies, dispatches, worktrees, checkpoints, reviews, questions, and events are durable host-owned records. SQLite is authoritative; the Runs renderer is a projection. |
| Code worker leases | A dispatch lease generation fences stale worker events. Restarted active dispatches are marked interrupted while identifiers are retained; a retry/resume action obtains a fresh generation. Heartbeats are durable and running leases become stale after the host-defined timeout. |
| Code worker boundary | Workers use the `codex-cli` adapter through a host-owned adapter boundary and structured `codex exec --json`/resume invocations in managed worktrees. Bounded HMAC-signed envelopes carry origin, worker sequence, nonce, and lease metadata; ephemeral secrets are not persisted. |
| Code fan-in and cleanup | Accepted dependency checkpoints can be merged non-interactively. Conflicts block the dependent task. Worktree cleanup requires exact confirmation and remains inside the managed local-data root. |
| Agent commands | Agent mutations are host-owned and scoped to named agents, explicit folder grants, bounded tools, skills, memory, artifacts, routines, plugins, and delegated child runs. Approval-required operations are fingerprinted and replay-safe. |
| Shared shell | Bootstrap, active mode, diagnostics, notifications, preferences, window state, and recovery markers are durable or host-validated. The renderer may request a view change but cannot widen a capability grant. |
| Release and recovery | Release metadata records protocol/product versions and clean-start markers. Backups are ZIP archives containing a manifest, consistent SQLite snapshot, and managed artifacts. Restore is staged, validated, atomic at the database/artifact-root boundary, and followed by an application restart. |
| Updates | The host owns update discovery and installation. The updater remains inert unless an HTTPS endpoint and signing public key are configured; installation is delegated to Tauri's signature-verified updater path. |

Run `cargo run -p agentic-super-app-tooling` to refresh generated DTO definitions after protocol changes. CI must fail if generated output drifts.
