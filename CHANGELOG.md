# Changelog

## 0.1.4 — 2026-09-07

### Pane preset builder

- Reworked preset creation around one **Add pane** picker instead of pre-created pane cards and several add buttons.
- Added separate standard and YOLO choices for every supported coding agent, with a warm amber treatment for YOLO groups.
- Added quantity controls that create or remove real saved panes, plus editable per-pane names.
- Added a pet-style unique-name generator for panes and host-side case-insensitive duplicate-name validation.
- Kept browser, terminal, Markdown, and detected coding-agent panes in the same builder so a preset opens the complete saved workspace setup.

### Release

- Bumped desktop, renderer, Rust workspace, and package metadata to `0.1.4`.

### Agent capabilities

- Added persisted Browser Use settings with inner Browser, external browser, and User's PC targets.
- Added `browser.snapshot` for bounded page text, visible controls, and follow-up selectors, plus direct `browser.open_external_url` handoff.
- Added native Computer Use tools backed by the checked-in Windows accessibility runtime: capabilities, app/window discovery, accessibility snapshots with optional screenshots, and approved click, type, key, scroll, drag, and value actions.
- Routed browser and desktop actions through the Agent approval timeline and updated the installed Browser Use and Computer Use skills with the real tool contracts.
