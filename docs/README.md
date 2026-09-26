# Hiveory documentation

This directory separates current product documentation from historical engineering records. The root [README](../README.md) is the user and developer overview. The documents listed under **Current documentation** describe version `0.2.2` and must be updated whenever their corresponding behavior changes.

## Current documentation

| Area | Document | Maintained with |
| --- | --- | --- |
| Feature status | [Feature reference](features/README.md) | user-visible behavior, implemented status, or a documented proposal |
| System boundaries | [Foundation architecture](architecture/hiveory-foundation.md) | application modes, service ownership, or trust boundaries |
| Public/private editions | [Private Dev boundary](architecture/private-feature-boundary.md) | Dev-only sibling checkout, production isolation, private prototypes, and boundary audit |
| Renderer UI | [Design system](design-system/README.md) | tokens, densities, shared primitives, accessibility, and private Dev exceptions |
| Renderer/host contract | [Internal protocol](architecture/internal-protocol.md) | Tauri commands, DTOs, streams, or replay rules |
| Storage | [Persistence architecture](architecture/persistence-schema-proposal.md) | SQLite migrations or secret-storage policy |
| Code workspaces | [Project and workspace hierarchy](architecture/code-project-workspace-hierarchy.md) | projects, worktrees, workspace selection, or trust |
| Panes and terminals | [Terminal pane workspace](architecture/terminal-pane-workspace.md) and [workspace fidelity](architecture/code-workspace-fidelity.md) | pane topology, PTY behavior, browser panes, or recovery |
| Code runs | [Code orchestration](architecture/code-orchestration.md), [coordination boundary](architecture/app-control-plane.md), and [orchestration threat model](architecture/code-orchestration-threat-model.md) | task DAGs, workers, mailboxes, gates, or worktree policy |
| Tasks and source control | [Source intelligence](architecture/source-intelligence.md) | Git, GitHub, Jira, Linear, Tasks, or board behavior |
| Release lifecycle | [Release and recovery](architecture/release-and-recovery.md) | startup, backup, restore, update, or packaging |
| Security | [Threat model](security/threat-model.md) and root [security policy](../SECURITY.md) | privileged capabilities, credentials, approvals, or network access |
| Builds | [Local build guide](builds/local-builds.md) | development, packaging, artifact names, or toolchain requirements |
| Local feature use and testing | [User manual](user-manual.md) | Plugins, Skills, Automations, Tasks, and Workspace board workflows |
| Source organization | [Repository conventions](architecture/repository-conventions.md) and [source layout](../src/README.md) | directories, crate ownership, or naming |

## Historical records

These files explain why the current system exists. They are retained as point-in-time records and are not a current feature matrix:

- [Architecture decision records](decisions/README.md) preserve accepted decisions and their original context.
- [Phase records](phases/README.md) preserve completed implementation plans and acceptance criteria.
- [Design specifications](superpowers/specs/README.md) preserve dated design proposals.
- [Release checklists](builds/README.md) preserve evidence and manual gates from specific milestones.
- [Verification evidence](verification/README.md) preserves results captured at a particular commit or phase.

Historical records can contain old paths, commands, scope statements, or deferred work. Use the current documentation above before making implementation decisions.

## Maintenance rules

1. Consult [the feature reference](features/README.md) for feature questions. Update the affected implemented feature page when behavior changes; keep planned proposals clearly uncommitted and promote shipped work in the same change.
2. Update the root README for user-visible capability or setup changes.
3. Update the owning architecture document in the same change as a boundary, persistence, security, or lifecycle change.
4. Add an ADR when responsibility, authority, or a lasting technical constraint changes.
5. Keep historical records intact except for broken links, factual annotations, or corrections that do not rewrite the original decision.
6. After documentation moves or public/private changes, run `pnpm verify`,
   `pnpm audit:identity`, and `pnpm audit:references`; also run
   `pnpm audit:private-boundary` when the edition boundary is affected.
7. Never describe a planned or simulated flow as implemented. State provider, credential, operating-system, and local-runtime requirements explicitly.
