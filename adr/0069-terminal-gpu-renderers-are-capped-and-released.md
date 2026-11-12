# ADR 0069 — At most twelve terminals keep a GPU renderer, and a released one frees its memory at once

Builds on ADR 0044 and 0066. Decided by the product owner, 2026-11-12.

## Context

Terminals draw with xterm.js's WebGL renderer, one WebGL context each. Chromium allows about 16
live WebGL contexts per window and drops the oldest past that ("Too many active WebGL contexts.
Oldest context will be lost."). A terminal whose context is dropped falls back to drawing with the
DOM for good: slower, and with gaps in box and block characters.

Two things pushed Hiveory past that limit:

- **Terminals off the page kept their context.** A terminal on another Worktree, or whose pane was
  closed elsewhere, keeps its xterm for 90 seconds (ADR 0044) so going back is instant, and its
  renderer with it. Three Worktrees of six agents meant 18 contexts.
- **A disposed renderer does not free its context.** `WebglAddon.dispose()` leaves the context to
  the garbage collector (xterm.js issue #6068, reported on the version Hiveory uses), so closed
  terminals' contexts still count, and their GPU memory stays taken until a collection. VS Code
  fixed the same leak by disposing explicitly (microsoft/vscode #279579).

Measured (`e2e:perf`, ADR 0066): switching among three Worktrees of six terminals made Chromium drop
contexts 16 times, and the GPU process grew to 432 MB. Opening and closing six terminals four times
over raised it from 284 to 355 MB.

## Decision

- **A released renderer frees its context at once.** When a terminal's renderer goes (the terminal
  is freed, or its context was lost), Hiveory disposes the addon and then calls
  `WEBGL_lose_context.loseContext()` on its context, the workaround the xterm.js issue gives until
  the addon does it itself (`releaseWebgl` in `terminal-registry.ts`).
- **At most twelve terminals keep a renderer** (`MAX_GPU_TERMINALS`), leaving room under Chromium's
  limit for the window's other contexts. Past twelve, the renderers of terminals off the page go
  first, the one shown longest ago first. Terminals on the page always keep theirs.
- **A terminal shown again gets its renderer back**, also one whose context was lost earlier, so a
  terminal never stays on the DOM fallback. Its output was kept throughout (ADR 0044).

Nothing changes for the user except that terminals keep drawing on the GPU.

## Consequences

- Measured on the same machine: switching among three Worktrees of six terminals drops no context,
  and every terminal on screen draws with WebGL; the GPU process holds 362–382 MB (was 432 MB).
  Opening and closing six terminals four times leaves it flat (287–310 MB). Switching Worktrees is
  as fast as before (next frame in 38–52 ms, no long task); releasing renderers on every switch
  instead had made it 88 ms, which is why the cap keeps recent ones.
- Going back to a Worktree last seen more than twelve terminals ago rebuilds its renderers, a few
  tens of milliseconds.
- More than twelve terminals on screen at once still use more than twelve contexts; the cap cannot
  help there.
- The release reaches into the addon's private renderer (`_renderer._gl`). When xterm.js ships the
  fix (#6069), that line goes. `e2e:perf` fails if contexts are dropped again.
- The GPU memory of terminals on screen (about 10 MB each, 45 MB for the first) is unchanged: it
  is what WebGL drawing costs.
