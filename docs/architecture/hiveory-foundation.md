# Foundation architecture

This document describes the current local-first desktop boundary for Hiveory `0.1.3`.

## Runtime shape

Hiveory has one React and TypeScript renderer inside a Tauri desktop application. The renderer presents state and sends typed user intent. The Rust host owns every operation that can affect files, processes, Git repositories, credentials, provider accounts, network services, approvals, persistence, notifications, backups, or recovery.

```text
React renderer
    │ typed Tauri commands, replies, and bounded event channels
    ▼
Rust desktop host
    ├── SQLite persistence
    ├── OS credential storage
    ├── workspace and Git capabilities
    ├── PTY/ConPTY and coding CLI processes
    ├── model and plugin networking
    ├── agent and code orchestration
    └── local scheduler, notifications, backup, restore, and updates
```

The renderer does not receive raw database access, stored credentials, arbitrary process execution, or unrestricted filesystem and network APIs. A selected application mode is presentation state and never grants authority.

## Application modes

### Agent

Agent mode owns named assistants, versions, folder grants, tools, skills, memory, artifacts, conversations, runs, approvals, and bounded child work. `hiveory-agent-domain` validates definitions and policy. `hiveory-agent-runtime` executes the durable run loop and records replay-safe events through `hiveory-persistence`.

Agent model requests use the shared OpenAI Responses gateway. The host constructs requests, keeps provider credentials in the OS store, and sets provider-side storage to false. Plugin tools become available only through an enabled, tested connection and an explicit agent grant.

### Code

Code mode owns registered projects, trusted workspaces, documents, pane layouts, terminals, browser panes, Git projections, task sources, and durable code runs.

- `hiveory-workspace-service` canonicalizes roots and enforces capability-scoped file access.
- `hiveory-code-domain` validates trust capabilities and deterministic pane-tree mutations.
- `hiveory-code-runtime` and `hiveory-terminal-host` own PTY lifecycle, bounded output, snapshots, reattachment, and process-tree termination.
- `hiveory-git-service` owns repository inspection and the bounded Git operations required by managed workspaces and checkpoints.
- `hiveory-code-orchestration` owns task graphs, dispatch leases, managed worktrees, questions, checkpoints, reviews, recovery, mailboxes, and gates.

Windows terminal profiles include CMD, PowerShell, and Git Bash when installed. Coding CLI panes support Codex CLI, Claude Code, Antigravity, and OpenCode when their executables are available. Browser panes are native child webviews and start at `https://www.google.com`.

### Chat

Chat is a standalone conversation domain. It owns folders, conversations, branches, typed message parts, turns, drafts, imports, and portable exports. It does not inherit Code workspace, terminal, Git, Agent, skill, or plugin access.

`hiveory-chat-domain` validates turn policy and context. `hiveory-artifact-store` imports bounded PDF, image, text, and Markdown attachments into application-managed storage. Provider events and read-model changes are persisted transactionally so interrupted turns remain inspectable and retryable.

## Shared services

| Service | Responsibility |
| --- | --- |
| `hiveory-protocol` | Versioned commands, replies, errors, events, and DTOs |
| `hiveory-persistence` | Forward-only SQLite migrations and durable domain projections |
| `hiveory-secret-store` | OS-backed credential storage and opaque secret handles |
| `hiveory-model-gateway` | Provider authentication, request construction, streaming, cancellation, and error normalization |
| `hiveory-job-runtime` | Durable jobs, checkpoints, cancellation, and restart reconciliation |
| `hiveory-tool-runtime` | Tool schemas, approval fingerprints, execution policy, and redacted audit records |
| `hiveory-plugin-runtime` | Declarative HTTPS manifests, connections, host allow-lists, invocation bounds, and tool risk |
| `hiveory-routine-scheduler` | Local schedule evaluation, catch-up, concurrency, execution limits, and delivery |
| `hiveory-notification-service` | Durable in-app notifications and host-mediated native notifications |
| `hiveory-security` | Shared validation and security policy primitives |
| `hiveory-platform-process` | Structured platform process management |

## Plugins and skills

Plugins are declarative HTTPS adapters, not native code loaded into the application. Built-in and custom manifests declare their HTTPS host allow-list, tools, schemas, credential style, permissions, and risk. Connections use user-owned credentials kept in the OS credential store. The host tests connections and enforces the manifest before a plugin can be granted to an agent or eligible CLI session.

Skills are validated local `SKILL.md` packages. The host maintains the catalog, parses bounded metadata, detects conflicts, and stores agent assignments. Built-in skills and user-imported skills use the same validation path.

## Tasks, board, and automations

Tasks combines real provider data from GitHub, Jira Cloud, and Linear with local Code run tasks. GitHub uses the authenticated local `gh` CLI. Jira and Linear use direct provider APIs with user-owned credentials. The workspace board persists local lane and pin organization; moving an external card does not mutate the provider workflow.

Automations are durable local schedules. The scheduler creates bounded Agent runs while Hiveory is available, applies catch-up and concurrency policy, and records every execution state. Automations can use explicit folder grants and tested plugin tools but cannot widen the selected agent's permissions.

## Persistence and recovery

SQLite is authoritative for durable application state and uses foreign keys, WAL mode, transactional writes, and forward-only migrations. Secret values and raw terminal byte streams stay outside ordinary SQLite fields. Active jobs, chats, terminals, agent runs, and code dispatches are reconciled on startup; ambiguous work becomes interrupted or reconciliation-required.

Portable backups contain a versioned manifest, a consistent SQLite snapshot, and application-managed artifacts. Restore is validated and staged before SQLite opens. The updater remains inert until an HTTPS endpoint and signing public key are configured.

## Current product boundary

Hiveory is single-user and local-first. It requires no Hiveory-hosted service. External features contact their provider directly using user-supplied credentials or a locally authenticated CLI. Remote Hiveory hosts, hosted synchronization, mobile control, messaging gateways, arbitrary native plugin execution, and a shared OAuth broker are outside the current implementation.

## Interface system

The desktop interface uses compact graphite surfaces, near-black backgrounds, thin neutral borders, restrained elevation, white primary text, muted secondary text, and clear keyboard focus. Color communicates provider identity or status only when paired with text or an icon. Source and terminal content use a monospace face; application controls use the shared interface type scale. Reduced motion, keyboard navigation, visible focus, and scalable pane layouts are cross-mode requirements.
