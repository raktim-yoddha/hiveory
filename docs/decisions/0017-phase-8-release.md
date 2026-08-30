# ADR 0017: Phase 8 release boundary

## Context

The three product contexts are implemented as Rust-owned vertical slices, but a public desktop release also needs lifecycle recovery, portable user data, upgrade plumbing, and a shell that remains usable without a provider account. Those concerns must not introduce a second backend in the renderer or silently widen its permissions.

## Decision

- The shipped version is `1.0.0` with protocol major `2`.
- The Tauri host owns update checks and installation. A build is considered update-enabled only when it receives an HTTPS endpoint and a signing public key through `HIVEORY_UPDATER_ENDPOINT` and `HIVEORY_UPDATER_PUBKEY`. The updater plugin is initialized for every build, but an unconfigured local build performs no network request.
- Backups are ZIP archives containing a consistent SQLite snapshot, a versioned manifest, and files from the application-managed artifact root. Archive extraction accepts only `database.sqlite3` and `artifacts/` entries, rejects symlinks and traversal paths, and enforces a one-gigabyte safety ceiling.
- Restore is two-phase. The user selects a validated archive, the host copies it into its private data directory, and the application restarts. The pending archive is applied before SQLite opens; the current database, WAL/SHM sidecars, and artifact directory are retained as pre-restore copies.
- Startup records a release marker with a null clean-shutdown timestamp. The close event records a clean timestamp and window geometry. A subsequent startup surfaces an unexpected-exit message and marks active operations interrupted through the existing recovery routines.
- Shell preferences that are strictly visual (scale, compact density, reduced motion) stay in renderer local storage. Secrets, active mode, window geometry, jobs, artifacts, conversations, and domain state remain host-owned.

## Consequences

This keeps ordinary development and unsigned local packaging functional without inventing fake release credentials. Maintainers must provide signing credentials and a real HTTPS release endpoint before publishing updater artifacts. A restore always has an explicit restart boundary, so a live database pool is never overwritten in place.

## Verification

- `cargo test -p hiveory-app-host` covers archive path safety and manifest validation.
- `pnpm check` covers the settings, command palette, notification center, and responsive shell.
- `pnpm app:dev` is the native launch smoke test; `pnpm app:build` is the local package smoke test.
- `pnpm release:check` runs the complete verification and identity/reference guards.
