# Product Specification

## Product Modes

Exactly two:

```text
Workspace
Chatspace
```

Chatspace is intentionally empty/minimal in the initial release.

## Project Lifecycle

```text
Open/Create Project
        │
        ▼
    Project Page
        │
        ├── Tasks / Kanban
        ├── Pull Requests
        ├── Workspaces
        └── Settings
```

Opening a Project does not create a Workspace.

## Workspace Lifecycle

```text
Project
   │
   ├── Main Workspace
   │
   └── Create Workspace
          │
          ├── Create empty
          │
          └── Configure CLIs
                   │
                   ▼
              Workspace
```

## Empty Workspace

```text
Workspace exists
      │
      └── zero CLI instances
              │
              ├── Open agent
              └── Load preset
```

## Workspace Creation Configuration

The configuration surface supports:

```text
Workspace name
Issue / PR association
CLI selection
Add all CLIs
CLI instance count
Auto-approve permissions
Preset
Create empty Workspace
```

## CLI Configuration

Example:

```text
Claude Code       [-] 2 [+]
Codex             [-] 1 [+]
Gemini            [-] 1 [+]
```

Launching the Workspace starts the requested number of independent instances.

If count = 2:

```text
Claude logo   Milo
Claude logo   Luna
```

## Project Kanban

The Project Tasks view is:

```text
┌──────────────────────────────────────────────────────────────┐
│ Idle             │ Working          │ Waiting for You       │
├──────────────────┼──────────────────┼───────────────────────┤
│ Workspace 1      │ Workspace 2      │ Workspace 1           │
│ [CLI logo] Milo  │ [CLI logo] Luna  │ [CLI logo] Kai        │
│                  │                  │                       │
│ Workspace 3      │ Workspace 1      │ Workspace 4           │
│ [CLI logo] Ruby  │ [CLI logo] Max   │ [CLI logo] Nova       │
└──────────────────┴──────────────────┴───────────────────────┘
```

Every card represents a real CLI instance.

Cards move automatically based on runtime state.

## Waiting for You

Examples:

```text
Waiting for permission
Waiting for input
Waiting for confirmation
```

These appear as card details.

## No Done Column

Completion means:

```text
Working → Idle
```

There is no history board.

## Workspace Pane Behavior

Each CLI has a pane.

Panes:

- have visible gutters
- can split right
- can split bottom
- can be rearranged
- can be swapped using Space-drag

## Pane Add

The pane header has `+`.

It opens:

```text
Placement
├── Right
└── Bottom

Agents
├── detected CLI
├── detected CLI
└── ...
```

## Preset Behavior

Presets store:

```text
CLI counts
Auto-approve
```

Presets do not store layout.

Selecting a preset replaces the current CLI configuration when the Workspace is in the appropriate empty/configuration state.

## Main Workspace

Main Workspace:

- is created by the user ("Create workspace" → "Project folder"), at most one per Project (ADR 0011)
- maps to the original project folder
- cannot be deleted
- can run CLI instances
- participates in the same Kanban as isolated Workspaces

## Isolated Workspace

Isolated Workspace:

- uses a linked worktree
- uses a local branch
- can run multiple CLI instances
- can be deleted according to workspace lifecycle rules

## Important Non-Features

Initial version does not include:

- agent-to-agent communication
- remote collaboration
- global Kanban across projects
- task history
- Done Kanban column
- user-controlled manual Kanban status
- multiple user-facing Tasks inside a Workspace
- Agent top-level mode
