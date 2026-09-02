# Production browser surface coordination

## Scope

Fix production browser panes without changing the Dev distribution contract. The browser must remain visually stable while Hiveory menus are open, resize with its pane continuously, and avoid persistent success warnings.

## Design

The embedded browser is a native child webview. It does not participate in the renderer's CSS stacking order, so increasing `z-index` cannot make React menus reliably cover it. A shared, reference-counted browser-surface coordinator will suspend every native browser surface while an application menu, popover, drag overlay, or dialog is open. Reference counting prevents one closing overlay from restoring browser surfaces while another overlay remains open.

Each browser pane will keep a captured frame for the suspended state. The native surface is hidden before application overlays are used, and the frame (or a dark neutral fallback) remains in the pane so opening a menu never produces a white browser area.

The pane-header split launcher will become an anchored dropdown attached to the plus button. It retains split-right/split-down selection and all existing pane types, supports Escape and outside-click dismissal, and does not add a full-window backdrop.

Browser bounds updates will be animation-frame scheduled and latest-value coalesced. ResizeObserver, window resize, and capture-phase scroll changes feed one queue, preventing stale native IPC calls from accumulating during panel drags. The native host will track visibility and avoid calling `show` on every bounds update.

Successful viewport changes will no longer produce the persistent yellow notice. Genuine browser errors and actionable operation results remain visible.

## Verification

- Unit-test nested surface blockers and latest-value bounds coalescing.
- Run renderer tests, lint/typecheck, and production build checks.
- Build the production MSI, setup executable, and portable executable into `releases/production`.
