# Architecture

## Goals

The architecture must support:

- local-first operation
- multiple projects
- multiple Workspaces per Project
- main and linked Git worktrees
- multiple concurrent CLI instances
- dynamic CLI discovery
- reusable CLI adapters
- reusable pane layout
- automatic Kanban state
- Electron security boundaries
- future Git/GitHub/GitLab/PR/CI integrations without coupling the UI to them

## Baseline Technology

The desktop foundation is Electron.

The UI is React with TypeScript.

Do not assume additional libraries are mandatory unless they already exist in the repository or an ADR approves them.

Electron is appropriate here because it provides a desktop application shell with Chromium and Node.js and supports Windows, macOS, and Linux from one JavaScript codebase. citeturn0search3

## Process Model

```text
┌──────────────────────────────────────────────────────────────┐
│                         Electron App                         │
│                                                              │
│  ┌──────────────────────┐                                    │
│  │ Renderer              │                                    │
│  │ React + TypeScript    │                                    │
│  │                       │                                    │
│  │ UI components         │                                    │
│  │ screens               │                                    │
│  │ UI state              │                                    │
│  └──────────┬───────────┘                                    │
│             │ typed API                                      │
│             ▼                                                │
│  ┌──────────────────────┐                                    │
│  │ Preload               │                                    │
│  │ contextBridge         │                                    │
│  └──────────┬───────────┘                                    │
│             │ IPC                                             │
│             ▼                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Main / Application Services                            │   │
│  │                                                        │   │
│  │ ProjectService                                         │   │
│  │ WorkspaceService                                       │   │
│  │ GitService                                             │   │
│  │ WorktreeService                                        │   │
│  │ CliRegistry                                             │   │
│  │ CliRuntimeManager                                      │   │
│  │ PresetService                                          │   │
│  │ PetNameService                                         │   │
│  │ LayoutService                                          │   │
│  │ PersistenceService                                     │   │
│  └────────────────────────────────────────────────────────┘   │
│             │                         │                        │
│             ▼                         ▼                        │
│       Git / filesystem         CLI processes / PTYs            │
└──────────────────────────────────────────────────────────────┘
```

Electron's official guidance recommends context isolation and controlled contextBridge APIs rather than exposing powerful primitives directly to renderer code. citeturn0search2turn0search4

## Domain Model

```text
Project
│
├── main Workspace
│   ├── main working tree
│   ├── branch context
│   └── CLI instances
│
├── isolated Workspace
│   ├── linked worktree
│   ├── local branch
│   └── CLI instances
│
├── isolated Workspace
│   └── ...
│
├── Pull Requests
└── Settings
```

## Project

```ts
interface Project {
  id: string
  name: string
  path: string
  repository?: RepositoryRef
  createdAt: string
  updatedAt: string
}
```

The exact persistence representation may differ.

## Workspace

```ts
interface Workspace {
  id: string
  projectId: string
  name: string
  kind: "main" | "isolated"
  path: string
  git?: {
    worktreeId?: string
    branch?: string
    baseRef?: string
  }
  createdAt: string
  updatedAt: string
}
```

## CLI Instance

```ts
interface CliInstance {
  id: string
  workspaceId: string
  cliId: string
  petName: string
  status: CliStatus
  conversationId: string
  paneId: string
}
```

## CLI Status

```ts
type CliStatus =
  | "idle"
  | "working"
  | "waiting-for-you"
```

Provider-specific runtime details are separate:

```ts
interface CliRuntimeDetails {
  status: CliStatus
  waitingReason?: "permission" | "input" | "confirmation" | "other"
  activity?: string
}
```

## CLI Registry

```text
CLI Registry
   │
   ├── Claude adapter
   ├── Codex adapter
   ├── Gemini adapter
   └── future adapters
```

The UI only sees normalized metadata.

```ts
interface CliDefinition {
  id: string
  displayName: string
  icon: IconReference
  detect(): Promise<CliAvailability>
  createAdapter(): CliAdapter
}
```

## CLI Runtime

The runtime manager owns process/session lifecycle.

```text
CliRuntimeManager
       │
       ├── launch(instance)
       ├── stop(instance)
       ├── sendInput(instance)
       ├── subscribe(instance)
       └── normalizeStatus(instance)
```

React must never own the process directly.

## Kanban State Flow

```text
             ┌───────────────┐
             │     IDLE      │
             └───────┬───────┘
                     │ starts work
                     ▼
             ┌───────────────┐
             │   WORKING     │
             └───────┬───────┘
                     │ needs user
                     ▼
        ┌──────────────────────────┐
        │     WAITING FOR YOU      │
        └────────────┬─────────────┘
                     │ user responds
                     ▼
             ┌───────────────┐
             │   WORKING     │
             └───────┬───────┘
                     │ finishes
                     ▼
             ┌───────────────┐
             │     IDLE      │
             └───────────────┘
```

A CLI may also transition:

```text
IDLE → WAITING FOR YOU
```

if it immediately needs user input.

Errors should be represented in runtime diagnostics without creating a fourth Kanban state.

## Kanban Scope

```text
Selected Project
      │
      ├── Workspace 1
      │    ├── CLI A
      │    └── CLI B
      │
      ├── Workspace 2
      │    └── CLI C
      │
      └── Workspace 3
           └── CLI D

                ↓

        Project Kanban Board

       Idle | Working | Waiting
```

Filter by `projectId`.

Do not query globally and then hide unrelated projects only in the UI.

## Worktree Service

The WorktreeService owns Git worktree orchestration.

```ts
interface WorktreeService {
  create(input: CreateWorkspaceWorktreeInput): Promise<Worktree>
  remove(worktreeId: string): Promise<void>
  list(repositoryPath: string): Promise<Worktree[]>
  repair(path: string): Promise<void>
}
```

Git supports multiple working trees attached to the same repository, with one main worktree and linked worktrees. citeturn0search0

## Pane Layout

Represent layout as a tree, not as fixed slots.

Conceptually:

```text
Split
├── Pane(A)
└── Split
    ├── Pane(B)
    └── Pane(C)
```

Possible split:

```ts
type LayoutNode =
  | {
      type: "pane"
      paneId: string
    }
  | {
      type: "split"
      direction: "horizontal" | "vertical"
      children: LayoutNode[]
      ratio?: number[]
    }
```

Do not couple layout nodes to CLI provider types.

## Swap

Space-drag swap:

```text
before:

Split
├── Pane A
└── Pane B

after:

Split
├── Pane B
└── Pane A
```

The layout service performs the operation.

## Presets

```ts
interface AgentPreset {
  id: string
  name: string
  cliSelections: Array<{
    cliId: string
    count: number
  }>
  autoApprove: boolean
}
```

No layout.

## Persistence

Persist domain configuration.

Do not persist:

- process handles
- PTYs
- raw child process objects
- transient drag state

On restart:

1. restore Projects
2. restore Workspaces
3. restore Presets
4. reconcile Git state
5. reconcile stale runtime instances
6. let the user/Workspace policy determine whether CLI processes are relaunched

Do not assume automatic process resurrection unless explicitly implemented and documented.

## Future Integration Boundary

Keep external integrations behind services/adapters:

```text
Integration layer
├── GitHub
├── GitLab
├── Pull Requests
├── CI
└── future providers
```

The current local-first implementation must not depend on remote services.

## Dependency Rules

```text
UI
 ↓
application API
 ↓
services
 ↓
adapters/infrastructure
```

Never:

```text
UI
 ↓
child_process
```

Never:

```text
React component
 ↓
git command
```

Never:

```text
KanbanCard
 ↓
Claude-specific process API
```

## Testing Layers

```text
Unit
 ├── status normalization
 ├── pet names
 ├── presets
 ├── layout operations
 └── Git command construction

Integration
 ├── workspace creation
 ├── worktree lifecycle
 ├── CLI adapter lifecycle
 └── IPC validation

UI
 ├── empty Project
 ├── empty Workspace
 ├── Kanban
 ├── pane layout
 └── preset flow
```

## Implementation Map

Where each architectural piece lives. Keep this in sync when moving code.

```text
src/
├── shared/                     pure, process-agnostic code (unit tested)
│   ├── domain/                 Project, Workspace, CliInstance, LayoutNode, Kanban types
│   ├── ipc/contract.ts         every IPC channel + zod schema + event types
│   ├── layout/                 split/dock/move/swap/resize, geometry, drop resolution
│   ├── naming/names.ts         the one pet-name / workspace-name service
│   ├── presets.ts              preset normalization/serialization
│   └── errors.ts               normalized AppError / Result
├── main/                       Electron main: all privileged work
│   ├── index.ts                bootstrap, process guards
│   ├── app/                    container (composition root), window, paths, logger
│   ├── ipc/                    router (sender check + validation), handlers, trust
│   └── services/
│       ├── projects/ workspaces/ agents/ layout/ presets/ kanban/
│       ├── git/                GitService, WorktreeService, GithubService (gh), command builders/parsers
│       ├── pty/                PtySession (deferred spawn, scrollback, headless mirror), env, shim resolver
│       ├── shell/              ShellService — side-panel terminals
│       ├── agent-tools/        MCP protocol + AgentTools (agents coordinating agents)
│       ├── chat/               ChatService, ChatStore, providers (per-CLI headless runs), stream parsers
│       ├── extensions/         Skills & MCP inventory
│       ├── settings/ updates/  App settings (themes…), electron-updater
│       ├── persistence/        StateStore (atomic JSON), schema + recovery
│       └── cli/
│           ├── adapters/       one file per CLI — the only provider-specific code
│           ├── registry.ts     dynamic discovery (PATH scan, no shell)
│           ├── runtime/        CliRuntimeManager (PTYs), scrollback buffer
│           ├── status/         status machine + PTY heuristics
│           └── hooks/          loopback hook server
├── preload/                    contextBridge: whitelisted invoke/on only
└── renderer/src/               React UI (no Node/Electron imports — lint-enforced)
    ├── styles/                 tokens.css (all design values), base.css
    ├── lib/                    typed api client
    ├── stores/                 Zustand caches + event bridge + notices
    ├── components/             reusable primitives (ui/, cli/, brand/)
    └── features/               shell, projects, project, kanban, workspace, workspace-create,
                                presets, panes, agents, terminal, side-panel, settings (+guide), chat
```

The adapter contract differs from the conceptual `CliAdapter` above: adapters
describe a provider (`buildLaunch`, `mapHookEvent`, `heuristics`), while
process lifecycle (`launch/stop/write/resize`) is generic in
`CliRuntimeManager`. See ADR 0006.

Status detection: ADR 0006. Data locations: ADR 0008. Fault isolation: ADR 0009.
Agent tools (MCP), Chat, Git options, themes, side panel, updates: ADR 0012.

### Agent tools data flow

```text
agent CLI ──MCP (HTTP, bearer)──▶ HookServer /mcp/<instanceId> ──▶ AgentTools(caller)
                                                                     ├─ AgentService (open/close)
                                                                     ├─ CliRuntimeManager (read screen, write input, status)
                                                                     ├─ LayoutService (arrange)
                                                                     └─ ShellService (terminal)
```

### Chat data flow

```text
Renderer composer ─IPC chat.send─▶ ChatService ─spawn (no shell)─▶ CLI headless
        ▲                               │ stdout lines → parser → ChatAccumulator
        └──────── chat.event (snapshots, ~20/s) ◀──┘ persisted to userData/chats/<id>.json
```
