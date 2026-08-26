# Threat Model

## Assets

User files, process execution authority, source-control credentials, provider credentials, conversation data, and approval history are high-value assets.

## Current controls

The renderer has non-privileged shell and diagnostics commands only. The host owns mode state, SQLite access, operating-system keychain access, provider networking, job cancellation, audit writes, and native notification dispatch. Renderer preview fallback has no authority. Provider diagnostics require an explicitly stored key and an explicitly selected model; diagnostic requests set provider-side response storage to false.

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

Security-sensitive implementation requires a new ADR and acceptance test before activation.
