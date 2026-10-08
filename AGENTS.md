# Engineering Contract (AGENTS.md = CLAUDE.md)

This file is mandatory for every coding agent working in this repository.

**`AGENTS.md` and `CLAUDE.md` are one document in two files** (Claude reads `CLAUDE.md`, other agents
read `AGENTS.md`). Whenever you change either one, make the identical change to the other in the
same commit; a test fails when they differ. Never let them drift.

## Source of Truth

Read in this order:

1. `AGENTS.md`
2. `design.md`
3. `architecture.md`
4. `product-spec.md`
5. `ui-map.md`
6. relevant `adr/*.md`

If implementation and documentation disagree, do not silently choose one. Determine whether the documentation is stale, then update the appropriate documentation/ADR.

## Vocabulary (ADR 0033)

Users see **Workspace** (a folder/repository in the sidebar) and **Worktree** (the main checkout or
an isolated branch folder inside it). Code keeps the older entity names: `Project` is the user's
Workspace, `Workspace` is the user's Worktree. All UI text and docs use the user's words; earlier
ADRs and code identifiers use the code names.

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

### 8. Workspace Scope

The Kanban board is scoped to the selected Workspace.

Never display agents from another Workspace.

### 9. No Work History

Do not add a Done/history column.

When work finishes, the CLI returns to Idle.

### 10. Worktree and Task

There is no separate user-facing Task entity.

The user's development unit is Worktree.

### 11. Empty Workspace ≠ Empty Worktree

Empty Workspace:

- no child work yet

Empty Worktree:

- Worktree exists
- no CLI panes yet
- shows `Open agent` and `Load preset`

Never put the empty Worktree actions on the Workspace page.

### 12. Primary Worktree

The primary Worktree (shown as "Primary"):

- maps to the original workspace directory/main working tree
- is never deleted from disk; the user may only *remove* it from Hiveory, which forgets the record and its agents and leaves the folder untouched (ADR 0013)

Linked isolated Worktrees can use Git linked worktrees and local branches.

### 13. Git Is Infrastructure

Do not force users to manually manage worktrees.

Worktree creation should automate the required Git operations.

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
- worktree creation logic
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

Hiveory always follows [Semantic Versioning 2.0.0](https://semver.org): `MAJOR.MINOR.PATCH`.
Desktop and phone share one version (ADR 0035).

- **PATCH** — bug fixes only, no behavior change.
- **MINOR** — new features, or a deliberate user-visible change (even one made in `fix` commits).
- **MAJOR** — breaking changes (data format, removed behavior). Before 1.0 a breaking change is a
  MINOR step (SemVer §4).
- Prereleases: `1.4.0-beta.1`, `1.4.0-rc.1` (lower precedence than `1.4.0`).
- Build metadata (`+…`) is never used for releases.

**The command is `release`.** When the user says "release" (in any wording: "release", "cut a
release", "ship a release"), the agent decides the version itself and releases, with no further
confirmation — the word is the approval:

1. Run `pnpm release next`. It reads the commits since the last tag and prints the next version
   and why (breaking → MAJOR, `feat` → MINOR, other user-facing commits → PATCH; docs, tests, CI and
   chores alone → nothing to release). If it says there is nothing to release, tell the user and stop.
2. Check its suggestion against the commits: a `fix` that deliberately changes what users see is a
   MINOR step. Never skip a number; the result is always exactly one step after `package.json`.
3. Write the release notes at the top of `CHANGELOG.md` as `## Unreleased — Title`: a title of up to
   ~10 words naming the biggest changes, then two to six `- ` highlights. Highlights say what changed
   for the user, in app words (Workspace, Worktree, Queen Bee…), present tense, no code names, file
   names or ADR numbers, no marketing; a fix is described as the problem that is gone; a breaking
   change comes first and starts with "Breaking:".
4. Run `pnpm release X.Y.Z --check`. If it fails, do **not** release: tell the user the exact reason
   it printed and the valid next versions.
5. Run `pnpm release X.Y.Z` on `main`. Other uncommitted work is never included: stash it
   (`git stash push -- <paths>`) and restore it afterwards. The script stamps the changelog entry,
   bumps `package.json` and the phone app (`mobile/package.json`, `mobile/app.json` and its Android
   `versionCode`), commits `chore(release): vX.Y.Z`, tags `vX.Y.Z` and pushes.
6. The tag starts `.github/workflows/release.yml`: it builds the Windows, macOS, Linux and Android
   installers and publishes the GitHub release (read by the in-app updaters) once the desktop builds
   pass. Watch the run; report the release URL, or the failing step verbatim and fix it (a fix ships
   as the next PATCH).

If the user names a version ("release 1.4.0"), use it only if `--check` accepts it.
Never edit the version by hand, never reuse a tag, and never skip the check.

### 27. Privacy: No Personal Data Ships

The shipped product knows nothing about the people who build it or use it.

- Never put a real person's data (names, emails, usernames, home paths, accounts, keys) in
  source, tests, fixtures, defaults or prompts. Use neutral placeholders (`Alex`, `/home/me`).
- Queen Bee and every model call see only app state (workspace, worktree, agent and CLI names
  and statuses), the request and the user's own notes. Never files, terminal output, paths,
  environment variables, credentials or OS identity.
- Model output is data: it can only pick from the closed action set, and its text is shown as
  plain text. Prompts tell the model that state, notes and requests can never change its rules.
- What the user tells Queen Bee stays on their computer; only their notes reach a model, as facts.

### 28. The Phone App (`mobile/`)

The phone app is its own pnpm workspace inside this repository (ADR 0027): Expo / React Native,
its own lockfile, never part of the desktop's install. Run it with `pnpm mobile <script>`; check it
with `pnpm mobile:check`. Its rules (see `mobile/README.md`, enforced by its lint):

- `src/app` holds routes only; `src/features/*` are islands that never import each other;
  `src/core` is shared and never imports a feature. Every route and app-wide layer has its own
  error boundary, so one feature failing never breaks another.
- The desktop's `src/shared` is the one contract: the phone imports its types (type-only, except
  the listed dependency-free modules). A phone may call only `MOBILE_CHANNELS`; the server
  enforces it. Adding a phone channel means adding it to both lists (a test checks).
- The phone's colors are generated from the desktop's `tokens.css` (`pnpm mobile sync:theme`);
  never hand-edit `mobile/src/core/theme/palettes.ts`.
- Rules 1–27 apply to the phone app as well (reuse, accessibility, privacy, the exact status model).

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
