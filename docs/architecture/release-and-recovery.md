# Release and recovery architecture

The application is local-first: the Tauri host owns the SQLite pool, artifact root, credential handles, active processes, and long-running domain services. The React layer can be discarded and rebuilt from host queries and streams.

## Startup sequence

1. The host resolves its private application-data directory.
2. A pending validated restore archive is applied before SQLite opens. The previous database and journal sidecars are retained as pre-restore files.
3. SQLite migrations run with foreign keys and WAL enabled.
4. The host recovers interrupted jobs, chats, orchestration dispatches, terminals, and agent runs.
5. A startup marker is written with `last_clean_shutdown_at_unix_ms = NULL`.
6. The renderer receives the bootstrap projection and can inspect diagnostics.

## Clean shutdown and unexpected exit

The window close event persists geometry and writes a clean-shutdown timestamp. If the next startup sees a release marker with no clean timestamp, the diagnostics projection tells the user that the previous session ended unexpectedly. Active operation state is never inferred as successful: existing recovery code marks it interrupted or reconciliation-required.

## Portable backup format

The host creates a temporary consistent database snapshot using SQLite `VACUUM INTO`, then packages it with a versioned manifest and managed artifacts. The archive writer skips symlinks, bounds entry count and total size, and uses only application-generated archive names. Restore validates the manifest and archive names again immediately before extraction. User-selected paths are never used as extraction roots.

## Update boundary

The updater plugin is host-initialized but runtime-configured. A missing endpoint or public key produces a typed `not_configured` status and no request. A configured check requires HTTPS and a signature-verified package before installation. The renderer receives version/status metadata, never update credentials or installer arguments.

## Operational diagnostics

Diagnostics exposes provider configuration status, recent durable jobs, retained notifications, recovery messaging, and live shared events. It intentionally does not expose raw secrets, arbitrary filesystem listings, or unrestricted process controls. The release checklist is the cross-platform manual gate for package, credential, PTY, WebView, notification, and restart behavior.
