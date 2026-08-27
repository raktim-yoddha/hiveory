# ADR 0012: Phase 3 Chat Vertical Slice

## Context

The product needs a standalone Chat mode that can stream provider responses while remaining independent from Code workspaces, terminals, Git, and shell capabilities. The slice also needs restart recovery, explicit attachments, portable export, and a transcript that does not reduce every provider output to untyped Markdown.

## Decision

Use SQLite as the authoritative local replay store and set provider requests to `store: false`. Persist conversations, branches, messages, typed parts, turns, attachments, drafts, and ordered Chat events. Apply provider sequence uniqueness to suppress duplicate deltas. Carry renderer request IDs into durable conversation, branch, and turn uniqueness guards for replay-safe mutations. Stream persisted events through a Tauri channel and recover from its monotonic global cursor.

Chat imports only PDF, PNG, JPEG, WebP, UTF-8 text, and Markdown. Imports are copied into an application-controlled content-addressed artifact root under explicit size/count limits. Chat sends `tools: []`; tool-call/result types exist in the protocol for later capability work but no Phase 3 command can execute a tool. Context overflow is a visible preflight failure; history is not silently trimmed.

## Consequences

The local database is the source of truth even when the provider is unavailable. A restart marks queued/streaming turns as interrupted and preserves their transcript state for retry. A provider switch is visible in each turn’s model/effort metadata. ZIP export contains a manifest with portable conversation metadata and an attachments directory. Multi-client synchronization and tool approvals remain future work.

## Verification

Rust unit tests cover command/provider replay and artifact policy. Renderer typecheck, lint, production build, and preview tests cover the typed client and accessible Chat surface. The reference and prohibited-name audits remain required before the Phase 3 gate.
