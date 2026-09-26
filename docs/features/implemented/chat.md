# Chat mode

**Status:** Current standalone conversation mode. Chat is distinct from Code workspaces and from the Dev-only private Agent runtime. Model and provider availability depends on host configuration and network access.

## Current surface

The Chat renderer is rooted at `src/apps/renderer/src/features/modes/chat/views/HiveoryChat.tsx`. Typed renderer calls live under `src/apps/renderer/src/shared/api/`. The Rust host owns provider requests and persistence; see `src/apps/desktop/src-tauri/src/application/`, `src/crates/modes/chat/`, `src/crates/core/hiveory-model-gateway/`, and `src/crates/core/hiveory-persistence/`.

The product overview and setup requirements are in the root [README](../../README.md#chat-mode). Use [internal protocol](../../architecture/internal-protocol.md), [persistence architecture](../../architecture/persistence-schema-proposal.md), and [security threat model](../../security/threat-model.md) for durable contracts.

Do not infer local Skills injection or Agent execution from Chat profile/protocol compatibility types without tracing a current source path that supplies those capabilities to a model request.
