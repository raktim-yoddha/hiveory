# Hiveory performance, browser, and workspace design

## Goal

Correct the reported desktop-browser, Markdown, window, and startup issues while
making workspace and mode switching predictably fast. Reorganize the application
into clear, feature-owned boundaries without changing persisted data or public
command contracts unnecessarily.

## Constraints

- Preserve existing Tauri command names, protocol compatibility, workspace data,
  and browser profiles.
- Keep the native WebView2 browser as the browser authority on Windows.
- Build a Windows GUI executable without an attached console window.
- Keep responsive websites responsible for their own hamburger menus; Hiveory must
  provide an accurately sized, centered device viewport so those menus appear.

## Target repository layout

The repository retains stable top-level application paths during this release to
avoid breaking release tooling, but each application is organized by responsibility:

```text
hiveory-renderer/src/
  app/                 shell, routing, shared screen state
  features/
    browser/           toolbar, viewport frame, capture and overlays
    workspace/         rail, panes, workspace controller, source and coordination
    markdown/          document editing, file actions and editor UI
    agent/
    chat/
  shared/              API client, UI primitives, utilities and styles

hiveory-desktop/src-tauri/src/
  app/                 Tauri bootstrap and command registration
  browser/             native WebView2 lifecycle, viewport and capture bridge
  code/                workspace-facing command handlers
  platform/            OS window/process helpers

hiveory-crates/
  hiveory-*/           domain and infrastructure crates, one capability per crate

tests/
  e2e/                 native desktop user-flow tests and fixtures
```

Moves are performed in small, compilable batches. Compatibility re-exports are
temporary only where a large move would otherwise create a risky all-at-once diff.

## Browser behavior

### Address bar

The browser URL bar has one dark visual surface. Focus is expressed through an
intentional border/box-shadow token, never a white background or browser-default
outline.

### Capture / Grab

The renderer owns the single status message and cancel action. The injected page
picker supplies visual hover/highlight affordances only; it no longer duplicates
instructions. Grab supports click-to-copy, C to copy the focused element, S for a
screenshot, context menu options, and Escape to cancel.

### New pane action

The pane header `+` opens one accessible split launcher. Browser creation is an
explicit launcher choice, creates a preview pane in the selected direction, and
cannot accidentally expose the underlying native browser surface while the dialog
is open.

### Responsive viewport

`default` uses the full browser stage. Every emulated viewport is contained in a
centered device canvas with a dark surrounding stage, fixed CSS dimensions, and
independent overflow. Native WebView bounds are calculated from that device canvas,
not from the full pane. The same geometry is used with and without the overflow
menu, eliminating the two mobile layouts shown in the report.

## Markdown documents

New files retain the collision-safe temporary `untitled*.md` name until the user
names them. The document header exposes Rename, Save, Reload, Preview, Copy, and
Share. Rename calls a dedicated safe workspace-file move operation, updates the
pane resource and title atomically, and keeps unsaved content protected. Save has
visible success/error state and Ctrl/Cmd+S remains supported.

## Desktop and performance

- Compile the Windows executable as a GUI subsystem application.
- Never spawn an external terminal during bootstrap. Embedded terminal processes
  only start after an explicit terminal/agent action.
- Use the correct overlapping-squares restore icon when maximized and a square
  maximize icon otherwise.
- Deduplicate workspace loads by making the selected workspace ID the sole load
  trigger and canceling stale requests.
- Apply pane focus locally first; persist it asynchronously without blocking input.
- Cache active workspace snapshots and retain costly browser/editor surfaces while
  switching shell sections where safe. Native browser bounds are hidden rather than
  destroyed during transient overlays.
- Defer noninteractive diagnostics, update checks, and auxiliary workspace panels
  until the initial interactive workspace is ready.

## Verification

1. Renderer unit tests cover browser viewport geometry, capture state, file naming,
   Markdown save/rename state, and load deduplication.
2. Rust tests cover safe workspace-file rename and no-terminal startup behavior.
3. Native Tauri E2E tests cover application launch without a console, browser plus
   launcher, Grab cancellation, responsive viewport geometry, Markdown save/rename,
   window maximize/restore, and repeated tab/workspace switching.
4. Run lint, typecheck, renderer tests, Rust format/clippy/tests, release build, and
   the native E2E suite. Record measured workspace-switch timings and require cached
   switches to remain responsive without a blocking host round trip.
