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
