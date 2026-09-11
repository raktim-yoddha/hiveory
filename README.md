# Hiveory

Hiveory is a local-first desktop workspace for AI agents, software development, and standalone AI chat. It combines persistent agents, native terminals, coding CLIs, an embedded browser, Git-aware workspaces, task sources, a Kanban board, plugins, skills, and scheduled automations in one Tauri application.

The React renderer presents application state, while the Rust host owns privileged operations such as filesystem access, process execution, credentials, persistence, networking, approvals, and recovery. Hiveory does not require a Hiveory-hosted backend. Features that contact services such as OpenAI, GitHub, Jira, Linear, Gmail, or Slack use credentials supplied by the user and communicate with those providers directly.

## Project status

Hiveory is currently version `0.1.4`. The repository includes a production Windows build pipeline that creates a portable executable, an NSIS installer, and an MSI package. Local builds are unsigned unless a Tauri signing key is configured.

## Application modes

Hiveory keeps three modes separate so each one has a clear capability boundary.

| Mode | Purpose | Main capabilities |
| --- | --- | --- |
| **Agent** | Create durable, reusable AI assistants | Named agents, conversations, folder grants, skills, plugins, memory, artifacts, approvals, run history, and automations |
| **Code** | Work on local repositories with terminals and coding agents | Trusted workspaces, multi-pane layouts, shells, coding CLIs, browser panes, Markdown, Monaco editing, Git, task orchestration, and coordination |
| **Chat** | Hold standalone AI conversations | Streaming responses, conversation folders, branching, retry, attachments, Markdown rendering, drafts, and export |

Use `Ctrl+1`, `Ctrl+2`, and `Ctrl+3` to switch between Agent, Code, and Chat. `Ctrl+K` opens the command palette, `Ctrl+B` toggles the sidebar, and `Ctrl+,` opens Settings.

## Agent mode

Agent mode is for assistants that retain an explicit configuration across sessions.

- Create and edit named agents with a selected model, instructions, runtime limits, and approval policy.
- Grant specific local folders instead of exposing the whole filesystem.
- Keep durable conversations, runs, tool calls, approval decisions, memories, and generated artifacts.
- Inspect interrupted or failed runs and retry them without losing the recorded history.
- Enable global skills for an agent and resolve skill conflicts explicitly.
- Grant only tested plugin connections and selected plugin tools.
- Require approval for mutating or externally visible tool calls according to the agent policy.
- Schedule an agent through the local Automations system.

The current model gateway uses the OpenAI Responses API. Provider requests are created by the Rust host and use `store: false`; credentials are never returned to the renderer.

## Code mode

Code mode is a desktop development workbench built around local projects and persistent workspaces.

### Projects and workspaces

- Register local projects and create workspaces under them.
- Open a folder as an untrusted workspace with read-only access.
- Explicitly trust a workspace before Hiveory permits file writes, process launches, Git operations, or local previews.
- Group workspaces hierarchically and restore the active workspace and layout after restart.
- Reveal the active workspace from the bottom-left navigation controls.

### Multi-pane workspace

The pane canvas supports recursive horizontal and vertical splits, drag-and-drop placement, resizing, renaming, swapping, maximizing, closing, and deterministic layout presets. The compact pane summary shows as many pane icons as space allows and finishes with the pane count.

Available pane types include:

- **Terminal** — CMD, PowerShell, or Git Bash on Windows.
- **Coding agent** — Codex CLI, Claude Code, Antigravity, or OpenCode when installed locally.
- **Browser** — a native embedded browser pane. New panes open at Google and also accept localhost URLs and normal web addresses.
- **Markdown** — create or open workspace Markdown documents.
- **Workspace tools** — source control, coordination, and other host-backed workspace surfaces.

Terminal sessions run through a native PTY/ConPTY host. Output is kept in a bounded scrollback buffer and replayed after a renderer remount. Sequence gaps trigger a snapshot resynchronization instead of silently clearing the pane. Running processes stay alive until the user closes or stops them, and closing a live pane requires an explicit decision.

### Files and Git

- Browse a capability-scoped workspace tree.
- Open files in Monaco Editor with language detection.
- Save through optimistic SHA-256 fingerprints so external edits produce a conflict instead of being overwritten.
- Inspect working-tree status, branches, commits, worktrees, conflicts, and per-file diffs.
- View GitHub issues and pull requests through the locally installed and authenticated `gh` CLI.
- Keep the last successful hosted-source snapshot when a refresh fails, with an explicit stale/error state.

### Runs and coordination

Code runs are durable task graphs rather than transient terminal tabs.

- Create manual tasks or inspect structured DAG proposals before accepting them.
- Run dependency-ready tasks in application-managed Git worktrees.
- Track worker leases, checkpoints, questions, reviews, and failures.
- Accept or reject checkpoints and perform non-interactive dependency fan-in.
- Pause, retry, resume, or clean up work through host-owned commands.
- Use durable participant mailboxes and decision gates from the Coordination pane.
- Recover interrupted dispatches after an application restart.

## Chat mode

Chat mode is intentionally independent from Code workspaces while still
supporting an explicit, per-conversation capability profile.

- Create, rename, organize, and delete conversations.
- Stream text and reasoning events from the configured model.
- Retry interrupted turns, edit messages, and branch a conversation.
- Preserve drafts and the active branch locally.
- Import bounded PDF, image, text, and Markdown attachments into application-managed storage.
- Render Markdown, syntax-highlighted code, tables, task lists, links, images, and mathematical notation.
- Export a conversation and its attachments as a sanitized portable archive.
- Use installed local Codex CLI, Claude Code, Antigravity, OpenCode, Cursor
  Agent, or Grok CLIs, with cached discovery and background health refresh.
- Configure conversation-only memory, approval policy, selected valid skills,
  validated plugin tools, and explicitly granted read-only folders from the
  chat inspector. The selected profile is recorded with each turn.

Chat never inherits terminal, Git, or the active Code workspace. Skills,
validated plugin tools, and folders are available only when selected in the
conversation profile; folder access is never granted automatically.

## Tasks and workspace board

The Tasks button in the top navigation opens a workspace-scoped view of real external and local work.

- **GitHub** uses the authenticated local `gh` CLI and repository detected from the selected workspace.
- **Jira Cloud** connects directly with the user's site URL, account email, and API token.
- **Linear** connects directly with a personal API key.
- Jira and Linear credentials are stored in the operating-system keyring.
- Tasks can be searched and filtered by provider, and provider items open at their original URL.

The full-screen workspace board combines connected GitHub, Jira, and Linear items with tasks from local Hiveory code runs. Cards are organized into Todo, In progress, In review, and Done. Dragged lane placement and pinned cards are stored locally. The pinned area stays on one line until expanded.

Moving an external item on the Hiveory board changes its local board organization; it does not silently mutate the provider's workflow state.

## Plugins

For step-by-step use and local acceptance testing of Plugins, Skills, Automations, Tasks, and the Workspace board, see the [user manual](docs/user-manual.md).

Plugins are declarative HTTPS integrations executed by the Rust host. They are not arbitrary native extensions.

The built-in catalog currently includes:

- GitHub
- Linear
- Gmail
- Slack
- Notion
- Cloudflare
- Supabase
- Vercel
- Stripe
- Shopify

Each catalog row has an enable switch and an options menu. Configuration supports user-owned token connections, connection testing, OS-keyring storage, agent grants, tool-level permissions, and removal. Read operations and externally visible POST operations are represented separately so approval policy can be enforced.

Users can also create a custom JSON HTTP plugin or import a plugin manifest. Custom manifests declare their allowed HTTPS host, tools, schemas, permissions, credential style, and risk level. The runtime validates manifests and blocks requests outside the declared host allow-list.

Hiveory does not ship shared service credentials. A provider may require the user to create an API token or complete OAuth independently and paste the resulting access token into the local connection form.

## Skills

Skills are local `SKILL.md` instruction packages shared with configured agents and supported coding CLI sessions. Hiveory includes more than twenty practical built-in skills covering:

- repository exploration, planning, debugging, code review, testing, and refactoring;
- security, dependencies, performance, accessibility, and UI/UX review;
- API integration, database migration, documentation, and Git workflow;
- release readiness, release notes, incident triage, research verification, folder briefs, decision logs, and workspace handoff.

The Skills surface can enable or disable a skill per agent, create a new local `SKILL.md`, and import an existing valid skill package. The host parses bounded frontmatter, validates identifiers and permissions, and reports conflicts instead of selecting one silently.

## Automations

Automations are durable schedules evaluated on the user's machine by `hiveory-routine-scheduler`.

- Create schedules manually or start with the repo audit, release readiness, daily review, and queue-check templates.
- Select the agent, prompt, timezone, cron expression, folder grants, and validated plugin tools.
- Configure catch-up, concurrency, delivery, duration, tool-call, and approval-timeout limits.
- Enable, pause, edit, archive, or run an automation immediately.
- Inspect every queued, running, approval-blocked, completed, failed, skipped, interrupted, or uncertain execution.
- Deliver results in the application and optionally through native notifications.

Automations run only while the local Hiveory scheduler is available. They do not depend on a Hiveory server.

## Local-first architecture

```text
React + TypeScript renderer
        │ typed Tauri commands and event channels
        ▼
Rust desktop host
        ├── SQLite persistence and migrations
        ├── OS credential store
        ├── model and plugin networking
        ├── workspace capabilities and Git
        ├── PTY/ConPTY processes and coding CLIs
        ├── agent and code orchestration
        └── routine scheduler, notifications, backup, and recovery
```

The renderer cannot read SQLite, retrieve stored secrets, run arbitrary processes, or grant itself filesystem access. All privileged requests are validated by the Rust host. Durable data uses SQLite with foreign keys and WAL mode. Secrets are represented in the database only by opaque references to the operating-system credential manager.

On startup, Hiveory applies migrations and reconciles incomplete jobs, chats, terminals, agent runs, and code dispatches. Ambiguous work is marked interrupted or reconciliation-required rather than reported as successful.

## Security model

Key controls include:

- explicit workspace trust and capability-scoped directory access;
- rejection of absolute paths, traversal, symlinks, and stale file fingerprints;
- structured process launches and process-tree termination;
- bounded terminal output, provider payloads, attachments, archives, and event streams;
- host allow-lists for plugin network access;
- OS-keyring storage and redacted diagnostics;
- durable approval records for mutating and externally visible agent tools;
- sandboxed preview surfaces without renderer capabilities;
- idempotent commands and monotonic event sequences for replay safety;
- signature verification for configured application updates.

See [docs/security/threat-model.md](docs/security/threat-model.md) for the detailed threat model.

## Repository layout

```text
src/apps/renderer/              React, TypeScript, Vite, xterm, Monaco, and UI state
src/apps/desktop/src-tauri/     Tauri application host and native commands
src/crates/hiveory-protocol/    Shared typed command, event, and data contracts
src/crates/hiveory-persistence/ SQLite schema, migrations, and durable projections
src/crates/hiveory-*-runtime/   Agent, code, job, plugin, terminal, and tool runtimes
src/crates/hiveory-*-service/   Workspace, Git, notification, and supporting services
docs/                           Architecture, decisions, security, phases, and build notes
tools/scripts/                  Development, release, and repository audit scripts
releases/                       Generated local production and development artifacts
techn/                          Read-only product research material; never compiled or copied
```

## Prerequisites

For development on Windows, install:

- Node.js and `pnpm` 10.12.1 or a compatible Corepack-managed version;
- the Rust stable toolchain with the MSVC target;
- Microsoft C++ Build Tools and the Windows SDK required by Tauri;
- WebView2 Runtime;
- Git.

Optional tools unlock their related features:

- GitHub CLI (`gh`) for GitHub source intelligence and Tasks;
- Git for Windows for Git Bash panes;
- Codex CLI, Claude Code, Antigravity, OpenCode, Cursor Agent, or Grok for
  their coding-agent panes and local Chat providers;
- an OpenAI API key and explicit model name only when using the legacy hosted
  OpenAI Agent provider.

## Development

Install dependencies and launch the native development application from the repository root:

```powershell
pnpm install
pnpm app:dev
```

Inspect the local Tauri toolchain:

```powershell
pnpm app:doctor
```

The renderer can be opened without the native host for visual development:

```powershell
pnpm --dir src/apps/renderer dev
```

Native filesystem, terminal, keyring, provider, and persistence functions are unavailable in the browser-only renderer.

Chat discovers and launches the installed local CLIs above using each CLI's
own sign-in flow. The legacy hosted OpenAI Agent provider can be configured
from Hiveory Settings/Diagnostics; its API key is written directly to the OS
credential manager.

## Building

Create a production portable executable and installers:

```powershell
pnpm app:build
```

Successful builds refresh:

```text
releases/production/Hiveory-portable.exe
releases/production/Hiveory-setup.exe
releases/production/Hiveory.msi
```

Create a portable development edition with isolated application data and a visible `DEV` label:

```powershell
pnpm app:build:dev
```

The development executable is written to `releases/dev/Hiveory-Dev-portable.exe`.

`pnpm app:build` produces unsigned local installers when `TAURI_SIGNING_PRIVATE_KEY` is unset. Signed updater artifacts require the private key paired with the public updater key in the Tauri configuration. Never commit the private key.

## Validation

Common checks from the repository root:

```powershell
pnpm check
pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Run the complete verification or release gate:

```powershell
pnpm verify
pnpm release:check
```

`release:check` includes repository identity and reference guards in addition to renderer and Rust validation.

## Useful documentation

- [Documentation index and maintenance policy](docs/README.md)
- [Foundation architecture](docs/architecture/hiveory-foundation.md)
- [Terminal pane workspace](docs/architecture/terminal-pane-workspace.md)
- [Code workspace fidelity](docs/architecture/code-workspace-fidelity.md)
- [Code orchestration](docs/architecture/code-orchestration.md)
- [Source intelligence](docs/architecture/source-intelligence.md)
- [Project and workspace hierarchy](docs/architecture/code-project-workspace-hierarchy.md)
- [Release and recovery](docs/architecture/release-and-recovery.md)
- [Internal protocol](docs/architecture/internal-protocol.md)
- [Architecture decisions](docs/decisions/README.md)
- [Local build guide](docs/builds/local-builds.md)
- [Contributing](CONTRIBUTING.md)

## Contributing

Keep the Rust host authoritative for privileged work, preserve unrelated local changes, add focused tests for behavior changes, and update the relevant architecture or threat-model document when a boundary changes. The `techn/` directory is research-only: do not copy its source, assets, identifiers, or product identity into Hiveory.

## License

Hiveory is licensed under the [Apache License 2.0](LICENSE).
