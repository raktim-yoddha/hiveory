# ADR 0009 — Fault Isolation

## Decision

One broken feature must not break the app.

- **Renderer**: an `ErrorBoundary` wraps the title bar, sidebar, current
  screen, each project tab, the pane layout, every agent pane and every
  terminal. A failure shows a local "Try again" fallback.
- **Async UI actions** go through `runAction`, which turns failures into
  notices with the operation, a next step and technical details behind a
  disclosure. Global `error`/`unhandledrejection` handlers are a last resort.
- **IPC**: every handler is sender-checked, zod-validated and wrapped; it
  returns `Result<T>` and never throws across the boundary.
- **Main process**: `uncaughtException`/`unhandledRejection` are logged, not
  fatal. A crashed renderer reloads automatically; agents keep running in main
  and terminals replay from main's scrollback buffer.
- **Persistence**: atomic writes (temp file + rename); an unreadable file is
  backed up and replaced; invalid records are dropped individually.
- **CLIs**: detection is per adapter; a launch failure becomes that agent's
  runtime error, not a failed Workspace creation. Hook server failure degrades
  to heuristics (ADR 0006).

## Amendment (ADR 0022)

- **Startup steps are features.** `guard()` (`src/main/app/guard.ts`) runs each optional step
  (chat history, hook server, wallpaper protocol, model tracker, computer use, Queen Bee's
  shortcut, agent resume) on its own. A failure is logged and listed in one notice once the window
  loads; the window always opens.
- **Reactions are independent.** Each reaction to a settings change is guarded separately, so one
  broken feature never skips the others or fails the save. Quit runs every disposer guarded, so the
  final state flush always happens.
- **Events never break their sender.** Main's `emit` contains send failures. In the renderer,
  `subscribe` contains each listener, so one throwing listener cannot stop the others hearing an
  event.
- **No orphan `'error'` events.** `PtySession` emits `'error'` only when someone listens;
  otherwise it writes the failure into the terminal (Node throws on an unheard `'error'`).
- **Process isolation** (CLIs, PTY hosts, MCP servers, the computer helper and browser pages run in
  their own processes) continues with the host daemon in ADR 0022: PTYs move out of main into a
  separate host process, the same one that runs on remote machines.
