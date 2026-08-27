# Internal Protocol v1

All renderer-to-host requests use original `agentic_super_app_*` command names. DTOs are owned by `agentic-super-app-protocol` and exported to TypeScript through `agentic-super-app-tooling`.

| Contract | Rule |
| --- | --- |
| Versioning | `ProtocolVersion.major` must match before a command is processed. Breaking changes increment it. |
| IDs | Future durable IDs use UUIDv7 strings; renderer input is untrusted. |
| Commands | `CommandEnvelope<T>` carries protocol, request ID, and payload. |
| Replies | `ResponseEnvelope<T>` echoes request ID and protocol. |
| Errors | `ApiError` has stable code, human message, retry class, and optional recovery action. |
| Streams | Shared and Chat streams use Tauri channels. Chat events include global and aggregate sequence numbers; the renderer reconnects from the last confirmed cursor and can query a bounded persisted backlog. |
| Chat commands | Chat mutations carry the same request ID through host validation and durable conversation/branch/turn uniqueness guards. Replaying a start, retry, edit, create, or branch command does not create a second effect. |
| Chat parts | `ChatMessagePart` is a tagged union for text, reasoning summary, status, error, attachment, image, citation, usage, and reserved tool call/result records. Ordinary Chat emits no tools. |

Run `cargo run -p agentic-super-app-tooling` to refresh generated DTO definitions after protocol changes. CI must fail if generated output drifts.
