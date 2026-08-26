# Internal Protocol v1

All renderer-to-host requests use original `agentic_super_app_*` command names. DTOs are owned by `agentic-super-app-protocol` and exported to TypeScript through `agentic-super-app-tooling`.

| Contract | Rule |
| --- | --- |
| Versioning | `ProtocolVersion.major` must match before a command is processed. Breaking changes increment it. |
| IDs | Future durable IDs use UUIDv7 strings; renderer input is untrusted. |
| Commands | `CommandEnvelope<T>` carries protocol, request ID, and payload. |
| Replies | `ResponseEnvelope<T>` echoes request ID and protocol. |
| Errors | `ApiError` has stable code, human message, retry class, and optional recovery action. |
| Streams | A later stream envelope will carry monotonic sequence and resumption cursor; the blank shell has no long-running stream. |

Run `cargo run -p agentic-super-app-tooling` to refresh generated DTO definitions after protocol changes. CI must fail if generated output drifts.
