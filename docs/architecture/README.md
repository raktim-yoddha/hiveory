# Architecture documentation

These documents describe the current Hiveory `0.2.0` implementation. The Rust desktop host owns durable and privileged state; the React renderer is a replaceable projection that communicates through typed Tauri commands and event streams.

Start with [Foundation architecture](hiveory-foundation.md), then follow the domain document relevant to a change. The complete documentation map and maintenance policy are in [docs/README.md](../README.md).

| Domain | Primary documents |
| --- | --- |
| Shared host and modes | [Foundation architecture](hiveory-foundation.md), [Internal protocol](internal-protocol.md) |
| Storage and recovery | [Persistence architecture](persistence-schema-proposal.md), [Release and recovery](release-and-recovery.md) |
| Code workspace | [Project hierarchy](code-project-workspace-hierarchy.md), [Pane workspace](terminal-pane-workspace.md), [Workspace fidelity](code-workspace-fidelity.md) |
| Code orchestration | [Lifecycle](code-orchestration.md), [Control plane](app-control-plane.md), [Threat model](code-orchestration-threat-model.md) |
| Tasks and source intelligence | [Source intelligence](source-intelligence.md) |
| Repository organization | [Repository conventions](repository-conventions.md) |
