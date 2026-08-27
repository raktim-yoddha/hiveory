# Conversation Reference Feature Inventory

| Capability | Evidence modules | State / boundary | Target owner | Acceptance status |
| --- | --- | --- | --- | --- |
| Command envelope | `docs/internals/overview.md` | command → decision → events | shared protocol | selected |
| Idempotent receipts | runtime internals | request receipt / replay | persistence | selected |
| Event projections | runtime internals | event log / cached projection | shared runtime | selected |
| Subscription cursors | connection runtime docs | monotonic cursor / resumption | shared protocol + Chat channel | selected |
| Provider driver registry | `docs/providers.md` | host-owned provider adapters | model gateway | selected |
| Checkpoints | internals docs | conversation checkpoint reference | chat domain | deferred |
| Attachments | connection/runtime docs | attachment identity and ownership | agentic-super-app-artifact-store + Chat persistence | selected |
| Multi-client synchronization | connection runtime docs | ordering and reconciliation | shared runtime + Chat event log | deferred |

The source is used to identify externally observable guarantees only; the target has an original Rust contract and implementation.
