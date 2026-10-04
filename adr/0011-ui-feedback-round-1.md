# ADR 0011 — Product Owner Feedback, Round 1

Decisions made directly by the product owner. They supersede conflicting
statements in earlier docs and ADR 0010.

## Main Workspace is created by the user

A Project starts with **no** Workspaces. The main Workspace (the project
folder itself) is created explicitly from "Create workspace" → "Project
folder", at most once per Project. Once created it still cannot be deleted
(AGENTS.md rule 12). Projects saved before this change that already had
agents in an implicit main Workspace keep it as a real record.

Each project row in the sidebar has a "+" that opens "Create workspace".

## No Workspace header bar

The Workspace screen is panes only. Project/Workspace context lives in the
sidebar; branch names are not shown in the pane area. Workspace actions
(delete) are in the sidebar row menu and the Workspaces tab.

## Status is shown by color only

Pane headers and Kanban cards show no status text ("Waiting for
confirmation" etc.). Status reads from the dot color, a colored accent on
Kanban cards, and an amber tint on panes waiting for you. The waiting reason
remains available in tooltips and accessible labels.

## Pane maximize

Every pane has Maximize/Restore (also: double-click the header). A maximized
pane fills the pane area; other panes stay mounted (terminals keep running)
but hidden. Maximize is transient UI state, not persisted.

## CLI coverage

The registry ships 23 CLIs (see `src/main/services/cli/adapters/catalog.ts`),
declaratively defined. Codex uses the OpenAI mark. Auto-approve is offered
only where a CLI documents a flag/env for it.

## Visual direction

Warm graphite surfaces with a bronze undertone, champagne-silver text and
metallic accents (design tokens in `tokens.css`). Saturated color stays
reserved for status.

## Rendering and performance

- PTYs spawn only after the terminal reports its real size (no first frame at
  the wrong width), with the bundled modern ConPTY on Windows.
- xterm uses the WebGL renderer (gapless box/block glyphs) and Unicode 11
  widths; resizes are debounced and deduplicated.
- Opening/closing agents updates the UI from the IPC reply (closing is
  optimistic); process teardown never blocks the reply; PTY output is
  coalesced per frame; workspace lists do no Git calls.
