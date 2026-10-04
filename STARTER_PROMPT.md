# ADE Starter Prompt

You are the primary implementation agent for a local-first desktop AI Development Environment (ADE).

Your job is to build the application described by the repository documentation. Treat the repository documentation as the source of truth and keep the implementation aligned with it.

## Read These First

Before changing code, read these files in this order:

1. `AGENTS.md` — mandatory engineering rules.
2. `design.md` — visual system and interaction rules.
3. `architecture.md` — application boundaries, domain model, state flow, and process model.
4. `product-spec.md` — product behavior and user-facing flows.
5. `ui-map.md` — screen/component map and layout drawings.
6. `adr/` — architectural decisions. Read relevant ADRs before changing an established decision.

If the repository already contains implementation-specific documentation, reconcile it with these files rather than silently inventing a conflicting architecture.

---

# 1. Product Definition

This is a **local-first AI Development Environment** for software development.

The application is a desktop application. The primary project object is a local repository/project folder.

The product has exactly two top-level modes:

- **Workspace**
- **Chatspace**

Chatspace is intentionally minimal/empty in the initial implementation. Do not invent features for it.

The product is visually inspired by the supplied BridgeMind reference: dark near-black surfaces, compact typography, rounded surfaces, subtle borders, clear pane gutters, restrained chrome, and dense but breathable desktop-tool layout.

Do not copy proprietary source code, assets, or implementation. Recreate the visual/interaction scope using our own components.

---

# 2. Core User Model

Use these user-facing concepts:

- **Project** — a local repository/project.
- **Workspace** — a development environment inside a project.
- **CLI Agent** — a running or configured coding CLI instance inside a workspace.
- **Preset** — a reusable CLI configuration.
- **Conversation** — the interaction stream belonging to an agent instance.

Do not introduce a separate user-facing "Task" object.

Internally, Git concepts remain implementation details:

- repository
- main working tree
- linked worktree
- local branch
- commit
- HEAD
- index

A non-main Workspace is backed by:

> one linked Git worktree + one local branch

The main Workspace is backed by:

> the repository's original/main working tree + its current/default branch context

Git worktrees are the mechanism that allows multiple branches to be checked out simultaneously; Git itself distinguishes one main worktree from linked worktrees. citeturn0search0turn0search8

The user should not need to manually operate `git worktree`.

---

# 3. Project Rules

The project is the primary object.

Creating/opening a Project must NOT automatically create:

- a Workspace
- a worktree
- an agent
- a branch
- a task
- a conversation

An empty Project is therefore different from an empty Workspace.

## Empty Project

An empty Project means:

- project exists
- no child Workspace/agent work has been created yet

The Project page may expose project-level navigation such as:

- Tasks / Kanban
- Pull Requests
- Workspaces
- Settings

Do NOT put `Open agent` or `Load preset` on the Project page.

## Empty Workspace

An empty Workspace means:

- Workspace exists
- its worktree/branch exists when isolation is required
- zero CLI agent panes have been opened

Opening an empty Workspace must show:

- `Open agent`
- `Load preset`

This distinction is mandatory.

---

# 4. Workspace Rules

A Workspace is the user-facing development unit.

A Workspace contains:

- workspace identity/name
- local path
- Git backing information
- zero or more CLI agent instances
- pane layout
- conversations
- workspace-level runtime state

There is no need for multiple Tasks inside one Workspace.

There is no need for multiple Workspaces inside one Task.

## Main Workspace

The main Workspace represents the original project working tree.

Rules:

- always visible
- cannot be deleted
- uses the actual project directory
- must not silently create a second checkout just to display it
- can run agents directly in it

## Isolated Workspace

When an isolated Workspace is created:

1. Determine the repository's base/default branch.
2. Generate a human-friendly Workspace name.
3. Generate a Git-safe local branch name.
4. Create the linked worktree.
5. Create/check out the local branch from the selected base ref.
6. Create the Workspace record.
7. Open the Workspace.
8. Launch the selected CLI instances if any were configured.

The user should experience this as "Create Workspace", not as manual Git worktree management.

---

# 5. Task/Kanban Model

The Project's Task screen is a **Kanban board of CLI agent instances**.

It is NOT:

- a list of active CLIs
- a history page
- a generic software-development task tracker
- a board containing only working agents

Every configured CLI instance belonging to a Workspace can appear on the board.

The board is **project-scoped**.

If Project A is open, its board shows CLI instances from Project A only.

Do not mix CLI instances from other Projects into the board.

## Exactly Three Columns

The initial board has exactly:

1. **Idle**
2. **Working**
3. **Waiting for You**

There is no Done column.

There is no Error column.

There is no Permission column.

There is no history column.

### Idle

The CLI is available and not currently executing work or waiting for human input.

When a CLI finishes its current operation, it returns to Idle.

### Working

The CLI is actively executing/processing work.

### Waiting for You

The CLI cannot continue without human intervention.

This includes:

- permission approval
- a question requiring user input
- confirmation
- clarification
- any other human decision required to continue

These are details of the Waiting for You state, not separate Kanban columns.

## Critical Rule

The Kanban is driven by actual CLI runtime state.

Users do NOT drag a card from Idle to Working to fake the runtime state.

Cards move automatically when the underlying CLI state changes.

The board is an observability/control surface for real state.

## No Work History

Do not create a completed-work history column.

A CLI that finishes returns to Idle.

If future history is required, implement it as a separate feature; do not contaminate the three-state Kanban.

---

# 6. Kanban Card Identity

Do not use text like "Claude" or "Codex" as the primary visual identity.

Use the exact CLI/provider logo for the configured CLI.

A card should visually communicate:

- CLI logo
- generated pet name
- Workspace name
- relevant current state/context

Example:

```text
┌─────────────────────────────┐
│  [CLI LOGO]        Milo     │
│                             │
│  Workspace 1                │
│                             │
│  Implement authentication   │
│                             │
└─────────────────────────────┘
```

The logo is the primary CLI identity.

The CLI's textual name can exist in details/tooltips/accessibility labels, but it should not dominate the card.

Do not invent fake provider logos. Use the provider's official/icon asset where licensing and implementation permit, or a documented neutral fallback.

---

# 7. Agent Instances

Multiple instances of the same CLI must be supported.

Example:

```text
Claude Code × 2
```

creates two distinct CLI instances:

```text
Claude logo   Milo
Claude logo   Luna
```

Each gets:

- unique runtime identity
- unique pet name
- independent process/session
- independent status
- independent conversation
- independent pane
- workspace association

Do not identify instances only by CLI type.

---

# 8. Pet Names

Pet names are short, human-friendly identifiers for CLI instances.

Rules:

- unique among simultaneously existing instances where practical
- easy to read
- not a substitute for the CLI logo
- deterministic enough to avoid accidental collisions when persisted
- generated from a reusable name service, not duplicated in UI components

Do not claim an exact algorithm from a reference video unless the video is actually available to the implementation agent.

Create a reusable:

```text
PetNameGenerator
```

with a small tested vocabulary/configuration layer.

---

# 9. Workspace Creation

Workspace creation uses a reusable configuration surface.

It must support:

- Workspace name generation
- issue association when applicable
- pull request association when applicable
- dynamic CLI discovery
- adding all detected/available CLIs
- per-CLI instance count
- auto-approve / YOLO permission setting
- preset selection
- creating an empty Workspace

The CLI list must be dynamic.

Do NOT hardcode only a few providers.

The application should detect supported/installed CLI integrations through a reusable CLI registry/discovery system.

---

# 10. Presets

Presets store only:

- selected CLI types
- number of instances for each CLI
- auto-approve permission setting

Presets do NOT store:

- pane placement
- pane dimensions
- split tree
- drag positions
- workspace-specific paths
- transient runtime state

When applying a preset to an empty Workspace, it defines the Workspace's initial CLI configuration.

Applying a preset replaces the existing CLI configuration; do not silently merge configurations.

Preset editing must reuse the same CLI configuration components used by Workspace creation.

Preset UI is relevant when the Workspace is empty.

If agents are already opened, do not present the empty-state `Load preset` option as though the Workspace were still empty.

---

# 11. Agent Pane System

The Workspace view is a multi-pane agent environment.

Each agent instance owns a pane.

Panes are independent surfaces with intentional visible gutters between them.

Do NOT make panes touch edge-to-edge like a traditional IDE split grid.

Use the BridgeMind-inspired visual density:

```text
┌──────────────────┐   ┌──────────────────┐
│                  │   │                  │
│     AGENT A      │   │     AGENT B      │
│                  │   │                  │
│                  │   │                  │
└──────────────────┘   └──────────────────┘
```

The space between panes is intentional.

## Pane Placement

A pane can be placed:

- Right
- Bottom

The `+` action in the pane header opens a reusable placement/agent menu.

The menu allows:

- Right
- Bottom
- available/detected CLI agents

Do not hardcode the agent list.

---

# 12. Pane Rearrangement

Support:

- recursive split layouts
- drag-to-edge docking
- visible drop previews
- pane rearrangement

Special interaction:

> Hold `Space` while dragging a pane, then release it over another pane to swap them.

Normal drag/drop:

- dropping at an edge changes docking/placement.

Space-drag:

- dropping over another pane swaps their positions.

The layout engine must be reusable and independent of individual CLI implementations.

---

# 13. CLI Runtime Architecture

Every CLI integration must implement a common adapter contract.

Conceptually:

```ts
interface CliAdapter {
  id: string
  displayName: string
  icon: IconReference
  detect(): Promise<CliAvailability>
  launch(input: LaunchInput): Promise<CliSession>
  stop(sessionId: string): Promise<void>
  sendInput(sessionId: string, input: string): Promise<void>
  getStatus(sessionId: string): CliStatus
}
```

Exact types may differ, but the architectural principle is mandatory.

Do not write provider-specific runtime logic directly inside React components.

The UI consumes normalized CLI state.

---

# 14. Status Normalization

CLI implementations may expose different raw states.

Normalize them into exactly:

```ts
type CliStatus =
  | "idle"
  | "working"
  | "waiting-for-you"
```

Provider-specific details belong in metadata:

```ts
interface CliRuntimeDetails {
  status: CliStatus
  waitingReason?: "permission" | "input" | "confirmation" | "other"
  activity?: string
  error?: string
}
```

Do not create extra Kanban states merely because one CLI has a richer internal state machine.

---

# 15. Architecture Boundaries

Use a clear separation:

```text
Renderer/UI
   │
   │ typed application API
   ▼
Preload / IPC boundary
   │
   ▼
Electron Main / Application Services
   │
   ├── Project Service
   ├── Workspace Service
   ├── Git Service
   ├── Worktree Service
   ├── CLI Registry
   ├── CLI Runtime Manager
   ├── Preset Service
   ├── Pet Name Service
   ├── Persistence
   └── File/System Services
```

The renderer must not directly perform privileged filesystem, Git, process, or shell operations.

Electron's documented model uses IPC between renderer and main processes, with privileged APIs exposed through a controlled preload/context bridge. Context isolation is recommended and enabled by default in modern Electron. citeturn0search1turn0search2

Follow Electron security guidance:

- context isolation enabled
- renderer Node integration disabled
- sandboxing where compatible
- narrow typed preload API
- validate IPC senders
- validate IPC arguments
- never expose raw powerful Electron/Node APIs to the renderer

citeturn0search4

---

# 16. Reusable Components Rule

This is mandatory.

**Always create reusable components for UI and reusable services for functionality.**

Do not implement one-off copies of the same behavior.

Examples of reusable UI components:

```text
Button
IconButton
Menu
Popover
Modal
Tooltip
Tabs
SegmentedControl
Toggle
CounterControl
CliLogo
AgentAvatar
AgentCard
KanbanColumn
KanbanBoard
WorkspaceCard
WorkspaceHeader
Pane
PaneHeader
PaneDropPreview
PresetEditor
CliSelector
CliCountControl
EmptyState
StatusIndicator
```

Examples of reusable functional modules:

```text
ProjectService
WorkspaceService
GitService
WorktreeService
CliRegistry
CliDiscoveryService
CliRuntimeManager
PetNameGenerator
PresetService
LayoutService
PersistenceService
```

If the same UI pattern appears twice, stop and extract it.

If the same behavior appears twice, stop and extract it.

Do not solve duplication by copying files.

React is specifically designed around composable, reusable components; keep components small, composable, and independently testable. citeturn0search5turn0search7

---

# 17. Component Design Rules

Prefer:

```text
primitive
  ↓
compound reusable component
  ↓
feature component
  ↓
screen
```

Example:

```text
IconButton
   ↓
PaneActionButton
   ↓
PaneHeader
   ↓
AgentPane
   ↓
WorkspaceScreen
```

Avoid:

```text
WorkspaceScreen.tsx
  ├── 900 lines of UI
  ├── Git calls
  ├── process spawning
  ├── preset logic
  ├── layout logic
  └── status normalization
```

Screens orchestrate components and state.

They should not become service containers.

---

# 18. State Management

Separate:

- persisted domain state
- ephemeral UI state
- runtime process state

Examples:

### Persisted

- Projects
- Workspaces
- Presets
- agent configuration
- workspace metadata
- pane layout if intended to persist

### Runtime

- CLI process handles
- PTY streams
- normalized CLI status
- permission requests
- active sessions

### UI

- selected project
- selected workspace
- open menus
- modal visibility
- drag state
- drop preview
- temporary form state

Do not put OS process handles or PTYs into persistent storage.

---

# 19. Git Rules

Git is infrastructure, not a prerequisite for understanding the product UI.

Opening/creating a Project should be possible without first manually creating a branch.

For isolated Workspaces, Git automation handles:

- branch creation
- worktree creation
- checkout
- cleanup

Use Git's worktree functionality rather than cloning the repository for every Workspace.

Git worktrees share the repository while providing separate working directories and per-worktree state such as `HEAD` and the index. citeturn0search8

Never silently switch the main Workspace's branch merely because another Workspace is opened.

---

# 20. Error Handling

Errors must be explicit and recoverable.

Never swallow:

- Git failures
- CLI launch failures
- worktree creation failures
- permission failures
- persistence failures

Use a normalized error model.

UI errors should provide:

- what failed
- what operation was being attempted
- useful next action
- technical details behind an expandable disclosure where appropriate

Do not show raw stack traces as the primary user experience.

---

# 21. No Hallucinated Features

Do not invent:

- remote collaboration
- agent-to-agent communication
- extra top-level modes
- task hierarchies
- work history
- extra Kanban states
- unnecessary cloud services
- arbitrary AI orchestration
- features not specified in the docs

If implementation requires a product decision that is not documented, stop and record the decision in an ADR rather than silently inventing behavior.

---

# 22. Development Workflow

For every implementation task:

1. Read the relevant documentation.
2. Inspect existing code before creating files.
3. Reuse existing components/services where possible.
4. Identify the correct architectural layer.
5. Implement the smallest coherent reusable unit.
6. Add/update types.
7. Add tests for non-trivial logic.
8. Run type checking.
9. Run linting.
10. Run relevant tests.
11. Verify the UI behavior.
12. Update documentation if architecture/behavior changed.

Do not rewrite working systems unnecessarily.

Do not create parallel implementations of an existing service.

---

# 23. UI Quality Bar

The UI should feel like a polished professional desktop development tool.

Priorities:

1. correct information hierarchy
2. consistent spacing
3. intentional pane gutters
4. subtle borders
5. restrained typography
6. compact controls
7. responsive resizing
8. keyboard accessibility
9. smooth state transitions
10. no visual clutter

Avoid:

- giant empty padding
- excessive gradients
- loud shadows
- generic SaaS dashboards
- bright default component-library styling
- inconsistent corner radii
- inconsistent icon sizes
- random spacing values

All dimensions should come from design tokens.

---

# 24. Required Documentation Wiring

The following relationship is mandatory:

```text
AGENTS.md
   │
   ├── references → design.md
   ├── references → architecture.md
   ├── references → product-spec.md
   ├── references → ui-map.md
   └── references → adr/
```

`AGENTS.md` is the engineering contract.

`design.md` is the visual/interaction contract.

`architecture.md` is the technical structure contract.

`product-spec.md` is the behavioral/product contract.

`ui-map.md` is the screen/layout contract.

ADRs document decisions that should not be casually reversed.

When one of these documents changes, check the others for consistency.

---

# 25. Definition of Done

A feature is not complete when it merely renders.

It is complete when:

- behavior matches the product spec
- UI matches the design system
- components are reusable
- functionality is in the correct service/module
- state boundaries are correct
- IPC is typed and constrained
- errors are handled
- tests exist where appropriate
- no duplicated implementation was introduced
- no undocumented feature was invented
- documentation remains consistent

When uncertain, prefer the smallest implementation that preserves the architecture and documented behavior.
