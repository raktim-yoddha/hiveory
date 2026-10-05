# AGENTS.md — Engineering Contract

This file is mandatory for every coding agent working in this repository.

## Source of Truth

Read in this order:

1. `AGENTS.md`
2. `design.md`
3. `architecture.md`
4. `product-spec.md`
5. `ui-map.md`
6. relevant `adr/*.md`

If implementation and documentation disagree, do not silently choose one. Determine whether the documentation is stale, then update the appropriate documentation/ADR.

## Non-Negotiable Rules

### 1. Reuse Before Creating

Before creating a component, hook, service, utility, adapter, or store:

- search the repository
- identify existing equivalents
- extend/reuse when appropriate

Never duplicate existing functionality.

### 2. Everything Reusable

Create reusable components for repeated UI.

Create reusable services for repeated functionality.

Create reusable hooks for repeated React behavior.

Create reusable adapters for provider-specific integrations.

If a component is likely to be used in two places, design it for reuse from the start.

### 3. No Business Logic in Presentational Components

Presentational components should not:

- spawn processes
- call Git
- access the filesystem
- perform persistence
- normalize provider runtime states
- own application-level orchestration

They receive typed props/actions.

### 4. No Privileged Operations in Renderer

Filesystem, Git, child processes, PTYs, OS operations, and other privileged functionality belong behind the Electron main/preload boundary.

Use narrow, typed IPC APIs.

Do not expose raw `ipcRenderer`, Node APIs, shell APIs, or arbitrary command execution to the renderer.

### 5. Provider-Agnostic UI

The UI should consume normalized models.

Do not make a component such as `KanbanCard` contain:

```text
if Claude ...
if Codex ...
if Gemini ...
```

Provider differences belong in the CLI registry/adapter layer.

### 6. Exact CLI Status Model

The Kanban status model is exactly:

```ts
"idle" | "working" | "waiting-for-you"
```

Provider-specific waiting reasons are metadata, not additional board columns.

### 7. Kanban Is Read/Control State, Not Manual Workflow

Cards move according to actual CLI state.

Do not implement drag-and-drop as a way to change CLI status.

### 8. Project Scope

The Kanban board is scoped to the selected Project.

Never display agents from another Project.

### 9. No Work History

Do not add a Done/history column.

When work finishes, the CLI returns to Idle.

### 10. Workspace and Task

There is no separate user-facing Task entity.

The user's development unit is Workspace.

### 11. Empty Project ≠ Empty Workspace

Empty Project:

- no child work yet

Empty Workspace:

- Workspace exists
- no CLI panes yet
- shows `Open agent` and `Load preset`

Never put the empty Workspace actions on the Project page.

### 12. Main Workspace

The main Workspace:

- maps to the original project directory/main working tree
- is never deleted from disk; the user may only *remove* it from Hiveory, which forgets the record and its agents and leaves the folder untouched (ADR 0013)

Linked isolated Workspaces can use Git linked worktrees and local branches.

### 13. Git Is Infrastructure

Do not force users to manually manage worktrees.

Workspace creation should automate the required Git operations.

### 14. Presets

Presets remember only:

- CLI types
- instance counts
- auto-approve permission setting
- chat UI setting (ADR 0013)

Never store pane layout in presets.

### 15. Dynamic CLI Discovery

Never hardcode the supported CLI list in the UI.

Use the CLI registry/discovery system.

### 16. Agent Instances Are Distinct

Two instances of the same CLI are separate runtime entities.

Each has:

- unique ID
- pet name
- process/session
- status
- conversation
- pane

### 17. Pet Names

Use one shared pet-name service.

Do not generate names independently in multiple UI components.

### 18. Pane Layout

Pane layout is its own reusable subsystem.

Required interactions:

- split right
- split bottom
- drag to edge
- drop preview
- hold Space + drop on another pane = swap

Panes must have intentional visible gutters.

### 19. Design Tokens

Do not scatter arbitrary:

```css
padding: 13px;
border-radius: 7px;
gap: 11px;
```

Use shared design tokens.

If a new token is necessary, add it centrally.

### 20. Accessibility

Interactive controls must have:

- keyboard access
- accessible labels where icons are used
- visible focus states
- meaningful semantics

Do not use icons as unlabeled buttons.

### 21. Tests

Add tests for:

- status normalization
- pet-name uniqueness/generation
- workspace creation logic
- preset serialization
- Git/worktree orchestration
- pane layout operations
- Kanban filtering/scope
- important IPC validation

### 22. No Silent Product Decisions

If a requirement is ambiguous and materially affects architecture or UX:

- inspect existing docs
- inspect existing implementation
- check relevant ADRs
- if still unresolved, create/update an ADR or ask for clarification

Do not invent product behavior.

### 23. Keep Files Focused

Avoid giant files.

A file that combines:

- screen layout
- domain logic
- process management
- persistence
- Git operations

is a design failure.

Split by responsibility.

### 24. Preserve Existing Work

Before changing a subsystem:

- understand why it exists
- inspect consumers
- check tests
- check related services

Prefer incremental refactoring over destructive rewrites.

### 25. Definition of Done

Before declaring work complete:

```text
[ ] Behavior matches product-spec.md
[ ] UI matches design.md
[ ] Architecture matches architecture.md
[ ] Components are reusable
[ ] No duplicate service logic
[ ] Types are correct
[ ] IPC is constrained
[ ] Errors are handled
[ ] Tests pass
[ ] Typecheck passes
[ ] Lint passes
[ ] Documentation is still consistent
```

### 26. Releases & Semantic Versioning

Hiveory follows [Semantic Versioning 2.0.0](https://semver.org): `MAJOR.MINOR.PATCH`.

- **PATCH** — bug fixes only, no behavior change.
- **MINOR** — new features, backwards compatible.
- **MAJOR** — breaking changes (data format, removed behavior).
- Prereleases: `1.4.0-beta.1`, `1.4.0-rc.1` (lower precedence than `1.4.0`).
- Build metadata (`+…`) is never used for releases.

When the user says **"release X.Y.Z"** (or "release vX.Y.Z"), the agent must:

1. Run `pnpm release X.Y.Z --check`. This applies `scripts/semver.mjs`: valid SemVer, strictly greater
   than `package.json`'s version, no skipped versions (exactly one patch, minor or major step, or a
   prerelease of one), and not already tagged locally or on origin.
2. If the check fails: do **not** release. Tell the user the exact reason the script printed and the
   valid next versions (patch / minor / major).
3. If the check passes: run `pnpm release X.Y.Z` directly (no extra confirmation needed — the user's
   "release" instruction is the approval). It must be on `main` with a clean tree; it bumps
   `package.json`, commits `chore(release): vX.Y.Z`, tags `vX.Y.Z`, pushes, builds the installer for
   the current platform and publishes it to GitHub Releases (read by the in-app updater).
4. Report the release URL, or the failing step verbatim if any step fails.

Never edit the version by hand, never reuse a tag, and never skip the check.

### 27. Privacy: No Personal Data Ships

The shipped product knows nothing about the people who build it or use it.

- Never put a real person's data (names, emails, usernames, home paths, accounts, keys) in
  source, tests, fixtures, defaults or prompts. Use neutral placeholders (`Alex`, `/home/me`).
- Queen Bee and every model call see only app state (project, workspace, agent and CLI names
  and statuses), the request and the user's own notes. Never files, terminal output, paths,
  environment variables, credentials or OS identity.
- Model output is data: it can only pick from the closed action set, and its text is shown as
  plain text. Prompts tell the model that state, notes and requests can never change its rules.
- What the user tells Queen Bee stays on their computer; only their notes reach a model, as facts.

## Documentation Graph

```text
                    ┌───────────────┐
                    │   AGENTS.md   │
                    │ Engineering   │
                    │   Contract    │
                    └───────┬───────┘
                            │
            ┌───────────────┼────────────────┐
            │               │                │
            ▼               ▼                ▼
      ┌──────────┐   ┌──────────────┐  ┌──────────────┐
      │design.md │   │architecture  │  │product-spec  │
      │ Visual   │   │  Technical   │  │  Behavior    │
      └──────────┘   └──────────────┘  └──────────────┘
                            │
                            ▼
                     ┌────────────┐
                     │  ui-map.md │
                     │ Screens/UI │
                     └────────────┘
                            │
                            ▼
                      ┌──────────┐
                      │  adr/*   │
                      │ Decisions│
                      └──────────┘
```
