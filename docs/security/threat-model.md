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

## Phase 3 controls verified in code

- Attachment imports reject symlinks/non-regular files, enforce PDF/image/text byte limits, validate magic/content, hash content, and store under an application-controlled root.
- Export paths are resolved from validated relative paths and archive entry names are reduced to file names, preventing traversal through attachment names.
- Chat event writes and read-model updates occur in the same SQLite transaction. Provider sequence uniqueness suppresses duplicate deltas/completions, while command request IDs guard replayed mutations.
- Context overflow is rejected before the provider request; Chat does not silently trim history or summarize it.
- Provider and secret failures return redacted user-facing diagnostics; credential values are never placed in Chat events or the database.

Security-sensitive implementation requires a new ADR and acceptance test before activation.
