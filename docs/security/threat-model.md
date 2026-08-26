# Threat Model

## Assets

User files, process execution authority, source-control credentials, provider credentials, conversation data, and approval history are high-value assets.

## Current controls

The renderer has only three non-privileged bootstrap commands. No filesystem, shell, process, network, clipboard, updater, or secret-store plugin permission is granted. The host owns mode state; renderer preview fallback has no authority.

## Deferred risks and required controls

| Threat | Required control before enabling capability |
| --- | --- |
| Prompt-induced tool misuse | explicit capability grant, per-action approval, redacted audit log |
| Renderer compromise | host-side authorization and validated typed commands |
| Provider credential exposure | OS secret store, no renderer secret access, redacted diagnostics |
| Terminal/process escape | command policy, workspace scoping, approval tiers, process-tree cleanup |
| Malicious repository content | workspace trust, path normalization, preview isolation |
| Event replay corruption | transactional migrations, idempotency receipts, monotonic sequence checks |

Security-sensitive implementation requires a new ADR and acceptance test before activation.
