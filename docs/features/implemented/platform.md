# Shared platform, storage, and delivery

**Status:** Local-first Windows desktop application. Local-first does not mean every feature works offline or background work survives application exit.

## Host ownership

Tauri and Rust own privileged operations; React is a projection through typed commands and streams. Current shared responsibilities include SQLite persistence, OS credential storage, provider networking, artifacts, process/PTY management, filesystem capabilities, notifications, recovery, and packaging. See `src/apps/desktop/src-tauri/src/application/`, `src/crates/core/`, [foundation architecture](../../architecture/hiveory-foundation.md), and [internal protocol](../../architecture/internal-protocol.md).

## Editions and limitations

Production and Dev use separate identities/data locations. Production has public Chat and Code behavior; private Agent execution and premium prototypes load only through Dev commands with the sibling private checkout. See [private Dev boundary](../../architecture/private-feature-boundary.md). External providers, coding CLIs, credentials, and Windows WebView2 affect local availability.

## Storage, security, and delivery

SQLite migration ownership and secret-storage contracts are documented in [persistence architecture](../../architecture/persistence-schema-proposal.md); privileged capability boundaries are in the [security threat model](../../security/threat-model.md) and root [SECURITY.md](../../../SECURITY.md). Build and artifact behavior are in [local builds](../../builds/local-builds.md) and [release and recovery](../../architecture/release-and-recovery.md). Do not promise signed updater output unless signing is configured.
