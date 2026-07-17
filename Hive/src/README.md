# Hive — source layout

Organised **by feature, not by file kind**. Everything one feature needs — its
UI, its store, its client code, its tests — lives in one folder. The old layout
(`components/` + `stores/` + `lib/`) smeared a single feature across three
directories, so nothing could be read or deleted as a unit.

```
src/
├── app/
│   └── HomePage.tsx        # the shell: title bar, docks, pane area
│
├── features/               # one folder per feature; owns its UI + state + tests
│   ├── browser/            # CDP-driven localhost preview pane
│   │   ├── BrowserPane.tsx
│   │   ├── cdp.ts          # Chrome DevTools Protocol client
│   │   └── browserStore.ts # captured screenshots + live pane controls
│   ├── dock/
│   │   └── RightDock.tsx   # right panel: chat / explorer / search / git
│   ├── memory/             # Nectar client (project memory over Tauri IPC)
│   ├── orchestration/      # goal -> worktree -> WorkerBee
│   │   ├── dispatch.ts           # drives @hiveory/hivemind's Orchestrator
│   │   ├── hivemindAdapters.ts   # HiveMind ports -> Tauri IPC
│   │   └── dispatchStore.ts
│   ├── queenbee/           # the planning chat + its tool-calling surface
│   ├── sessions/           # agent session history
│   ├── settings/           # settings UI + provider/model stores
│   ├── task-comb/          # Task Comb panel (pipeline/progress/tasks/history)
│   ├── terminal/           # shell panes (xterm)
│   ├── worker-bees/        # CLI agent panes + the pane grid
│   └── workspaces/         # workspace sidebar, tabs, store
│
└── shared/                 # used by 3+ features; no feature owns it
    ├── tauri.ts            # Tauri API loader
    ├── projectStore.ts     # the open project path
    ├── uiStore.ts          # sidebar open/closed
    └── CommandPalette.tsx
```

## Rules

- **Domain logic belongs in the root packages**, not here. Hive borrows
  `@hiveory/{hivemind,queenbee,taskcomb,nectar,worker-bees}` and supplies thin
  adapters for side effects (see `features/orchestration/hivemindAdapters.ts`).
  If you're writing board rules or orchestration policy in `Hive/`, it's in the
  wrong repo folder.
- **A feature owns its store.** `workerBeesStore` lives in `worker-bees/`, not a
  global `stores/`. Only genuinely cross-cutting state goes in `shared/`.
- **Tests sit next to what they test** (`cdp.test.ts` beside `cdp.ts`).
- **Cross-feature imports use `@/features/<name>/...`.** Within a feature, use
  relative paths.
