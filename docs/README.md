# Hiveory documentation

This directory separates current product documentation from historical engineering records. The root [README](../README.md) is the user and developer overview. The documents listed under **Current documentation** describe version `0.1.3` and must be updated whenever their corresponding behavior changes.

## Current documentation

| Area | Document | Maintained with |
| --- | --- | --- |
| System boundaries | [Foundation architecture](architecture/hiveory-foundation.md) | application modes, service ownership, or trust boundaries |
| Renderer/host contract | [Internal protocol](architecture/internal-protocol.md) | Tauri commands, DTOs, streams, or replay rules |
| Storage | [Persistence architecture](architecture/persistence-schema-proposal.md) | SQLite migrations or secret-storage policy |
| Code workspaces | [Project and workspace hierarchy](architecture/code-project-workspace-hierarchy.md) | projects, worktrees, workspace selection, or trust |
| Panes and terminals | [Terminal pane workspace](architecture/terminal-pane-workspace.md) and [workspace fidelity](architecture/code-workspace-fidelity.md) | pane topology, PTY behavior, browser panes, or recovery |
| Code runs | [Code orchestration](architecture/code-orchestration.md), [coordination boundary](architecture/app-control-plane.md), and [orchestration threat model](architecture/code-orchestration-threat-model.md) | task DAGs, workers, mailboxes, gates, or worktree policy |
| Tasks and source control | [Source intelligence](architecture/source-intelligence.md) | Git, GitHub, Jira, Linear, Tasks, or board behavior |
| Release lifecycle | [Release and recovery](architecture/release-and-recovery.md) | startup, backup, restore, update, or packaging |
| Security | [Threat model](security/threat-model.md) and root [security policy](../SECURITY.md) | privileged capabilities, credentials, approvals, or network access |
| Builds | [Local build guide](builds/local-builds.md) | development, packaging, artifact names, or toolchain requirements |
| Source organization | [Repository conventions](architecture/repository-conventions.md) and [source layout](../src/README.md) | directories, crate ownership, or naming |

## Historical records

These files explain why the current system exists. They are retained as point-in-time records and are not a current feature matrix:

- [Architecture decision records](decisions/README.md) preserve accepted decisions and their original context.
- [Phase records](phases/README.md) preserve completed implementation plans and acceptance criteria.
- [Design specifications](superpowers/specs/README.md) preserve dated design proposals.
- [Release checklists](builds/README.md) preserve evidence and manual gates from specific milestones.
- [Verification evidence](verification/README.md) preserves results captured at a particular commit or phase.
- [`tauri-agent-super-app-prd.md`](../tauri-agent-super-app-prd.md) is the original planning brief and is superseded by the current README and architecture documents for implemented behavior.

Historical records can contain old paths, commands, scope statements, or deferred work. Use the current documentation above before making implementation decisions.

## Maintenance rules

1. Update the root README for user-visible capability or setup changes.
2. Update the owning architecture document in the same change as a boundary, persistence, security, or lifecycle change.
3. Add an ADR when responsibility, authority, or a lasting technical constraint changes.
4. Keep historical records intact except for broken links, factual annotations, or corrections that do not rewrite the original decision.
5. Run the documentation checks described in [Contributing](../CONTRIBUTING.md) after moving documentation.
6. Never describe a planned or simulated flow as implemented. State provider, credential, operating-system, and local-runtime requirements explicitly.
