# Design System

## Design Direction

The visual target is the supplied BridgeMind reference.

Recreate the same **design scope and visual language**, not proprietary source code or assets.

The application should feel like a focused professional developer tool:

- dark
- compact
- restrained
- rounded
- layered
- pane-oriented
- subtle
- information-dense without feeling cramped

## Core Principle: Surfaces Need Air

Panes/cards are individual surfaces.

There is visible space between them.

```text
┌────────────────────┐      ┌────────────────────┐
│                    │      │                    │
│       PANE A       │      │       PANE B       │
│                    │      │                    │
└────────────────────┘      └────────────────────┘
            ↑                         ↑
          gutter                    gutter
```

Never collapse adjacent panes into one continuous rectangle unless a specific control requires it.

## Visual Hierarchy

```text
Application background
    ↓
Navigation/sidebar
    ↓
Page surface
    ↓
Card/pane surface
    ↓
Interactive controls
    ↓
Status / accent
```

Use contrast primarily through:

- surface elevation
- border contrast
- text hierarchy
- spacing
- status indicators

Do not depend on loud colors.

## Color System

Define centralized CSS variables/tokens.

Conceptually:

```css
--color-bg
--color-surface
--color-surface-raised
--color-surface-hover
--color-border
--color-border-subtle

--color-text
--color-text-secondary
--color-text-muted

--color-accent
--color-success
--color-warning
--color-danger
```

Implemented palettes (`src/renderer/src/styles/tokens.css`): **Dark** (default) —
pure black and neutral grey, perfectly flat, no gradients or sheen; **Bronze** —
warm graphite with champagne-silver text and metallic accents; **Silver** — cool
graphite with brushed-silver accents (ADR 0044: three built-in themes; VS Code themes cover
the rest). Saturated color only for status. Component fills are `--fill-*`
tokens so a theme can flatten them (ADR 0011, 0012, 0013, 0017).

Every theme is flat: solid colors only — no gradients, sheen or textures. Containers
have no resting outline; a border appears only on hover, focus or selection, and a
pane's header shares its body's surface (no dividing line) (ADR 0018).
One exception: the worktree bar's buttons, a chat's approval and question cards and the terminal
find bar are key caps with depth (`--fill-key`, `--shadow-key`; their main action brushed steel,
`--fill-steel`; chosen is silver, never the waiting color) (ADR 0018 amendment 2026-11-13). A pane that
needs you shows a soft silver rim, not an ochre outline.

Selection is a tinted fill, never an outline: selected chips, option cards and "on"
badges use `--fill-accent-soft` with `--color-accent` text or check, which reads in every
theme; a chosen card among cards (a theme) uses the brighter `--fill-chosen`, and its
hover is a fill too (ADR 0044). A border is reserved for keyboard focus and the active pane (ADR 0018).

Themes set opaque `--base-*` surfaces; components use `--color-surface*`, which
become translucent over a wallpaper — one `--surface-alpha` for every surface. Dialogs use
`--color-surface-solid`. Third-party brand marks sit on `--color-logo-tile`.
VS Code color themes map onto these same tokens (plus `--syntax-*` for the editor and
`--shadow-tint`), layered over the built-in theme (ADR 0034) — a new color need is a new token,
never a component special case.
The app logo is shown flat — no glow, shadow or gradient (ADR 0017).

Do not scatter literal colors across components.

## Typography

Use a compact modern UI typeface.

Hierarchy:

```text
Page title
Section title
Workspace/agent title
Body
Secondary metadata
Tiny status/meta
```

Avoid oversized marketing typography.

## Radius

Use a small shared radius scale.

```text
small  → controls
medium → cards
large  → major panes/dialogs
```

Do not invent a new radius for every component.

## Borders

Borders should be subtle.

The border should define surfaces without becoming the visual focus.

## Shadows

Use restrained elevation.

Do not use large, decorative SaaS-style shadows.

## Icons

Icons are compact and consistent.

Provider/CLI identity uses the actual provider logo where permitted.

Generic actions use the application's shared icon set.

"Agent" is drawn with Hiveory's own `AgentIcon` (a hive cell holding a prompt), never a
generic robot. A CLI's logo appears where the CLI must be identified (pane header, pickers,
cards) and nowhere it would repeat what is already on screen — chat replies carry no avatar.

## Dropdowns

Every dropdown is the shared `Select`: a themed listbox (keyboard, type-ahead, groups,
`size="sm"` for toolbars). Never ship a native `<select>` — its popup is drawn by the OS
and ignores the theme. Menus, popovers and listboxes opened inside a modal dialog are
portaled into that dialog, and the in-app browser page steps aside while any is open.

All icon buttons require accessible labels/tooltips.

## Sidebar

The left navigation is a single Workspaces sidebar in Work mode.

It contains:

- Workspaces heading
- sort control
- add/create/open workspace control
- workspace list

The sidebar should feel like the BridgeMind reference: compact, dark, subtle, and not visually heavy.

## Top-Level Navigation

No modes and no title bar (ADR 0056). The sidebar, the main area and the side panel are cards that
start at the top of the window, with a little air above them (`--page-top`) and the page padding
on the other sides; their top bars share one height (`--pane-header-height`). The sidebar's top bar
holds the brand (logo, name, the inverted DEV chip in development builds) and the sidebar toggle; it drags the window. The side-panel toggle sits at the top
right, on the top bars' centre line. Settings sits in the sidebar's
footer. A hidden sidebar folds to an icon rail (a narrow card) with the same buttons. The side panel
itself has no close button (the toggle, or dragging it narrow, hides it). On Windows and Linux the
window controls sit transparently over the top-right card's header, which leaves them and the
side-panel toggle room; on macOS
the traffic lights sit at the start of the sidebar's top bar.

Do not add Agent mode.

Do not add top-level modes.

## Workspace Page

The Workspace page is workspace-level (its tasks, worktrees with their reviews, issues, schedules and settings). It lives
in the side panel as the "Dashboard" tab beside the open Worktree (ADR 0038, 0039), so it is drawn compact:
a small header with the workspace's mark, then the tabs; narrow, the board's columns stack and
setting rows put their control under the text.

Conceptual layout:

```text
┌───────────────────────────────────────────────────────────────┐
│ Workspace name                                    Settings    │
├───────────────────────────────────────────────────────────────┤
│ Tasks   Worktrees   Issues   Schedules   Settings              │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                   WORKSPACE CONTENT                            │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

Do NOT show:

- Open agent
- Load preset

on this page.

## Empty Worktree

An empty Worktree is different.

```text
┌───────────────────────────────────────────────────────────────┐
│ Worktree 1                                     [ ... ]        │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                    Empty Worktree                             │
│                                                               │
│                 [ Open agent ]                                │
│                 [ Load preset ]                               │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Worktree Agent Panes

When populated:

```text
┌───────────────────────────────────────────────────────────────┐
│ Worktree 1                                                    │
├───────────────────────────────────────────────────────────────┤
│ ┌───────────────────┐     ┌───────────────────┐              │
│ │ [logo] Milo   + ⋯│     │ [logo] Luna   + ⋯ │              │
│ ├───────────────────┤     ├───────────────────┤              │
│ │                   │     │                   │              │
│ │     terminal      │     │     terminal      │              │
│ │                   │     │                   │              │
│ └───────────────────┘     └───────────────────┘              │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

The gap between panes is intentional.

Every pane keeps its minimum size (`--pane-min-width` / `--pane-min-height`, or more for a CLI
that needs wider terminals), and a group of panes keeps the sum of its panes'. Nothing outside
the layout takes that space: the sidebar and side panel give way first — their handles stop at
the panes' minimum, and a shrinking window narrows them down to their own minimums before any
pane. Inside the layout, a pane below its minimum (after a split, or a window growing back) takes
the space back from neighbours that have room. Only a window too small for everything shrinks
panes, all in proportion to their minimums.

A terminal sits close to its pane's edges (a few px of inset; the scrollbar is the right gutter).
A narrow pane zooms its terminal text out — 13px down to 8px, snapped to whole device pixels —
so a CLI keeps about 50 columns, or the columns it needs (the registry's `minColumns`), instead
of wrapping its logo, prompt box and folder footer; widening the pane zooms back in. Only a
window too small for a CLI's minimum goes below 8px, never clipping its columns.

Height works the same way. A full-screen TUI (OpenCode, Kilo Code) draws its parts over each
other when too short, so it always gets the rows it needs (the registry's `minRows`): a short
pane zooms out one step at most, then shows the part of the taller grid that matters — the
bottom, or the rows at the cursor when that is where the user types (a home screen's centered
prompt) — and fades the cut edges. The same pane size always gives the same font, grid and view.

## Pane Header

A pane header may contain:

- provider logo
- pet name
- runtime/status indicator (color only)
- plus action
- maximize / restore
- close action

Plus, maximize and close are always visible, at any pane width; the name truncates and the
status detail drops first. Pane actions (restart, move, close) open from a right-click on the
name.

There is no Worktree header bar above the panes (ADR 0011).

Avoid unnecessary text.

## Kanban

The Workspace's Task view is a three-column board:

```text
┌─────────────────────────────────────────────────────────────────┐
│ Tasks                                                           │
├──────────────────────┬──────────────────────┬───────────────────┤
│ IDLE                 │ WORKING              │ NEEDS YOU         │
├──────────────────────┼──────────────────────┼───────────────────┤
│ ┌──────────────────┐ │ ┌──────────────────┐ │ ┌───────────────┐ │
│ │ [logo] Milo      │ │ │ [logo] Luna      │ │ │ [logo] Kai    │ │
│ │ Worktree 1       │ │ │ Worktree 2       │ │ │ Worktree 1    │ │
│ └──────────────────┘ │ └──────────────────┘ │ └───────────────┘ │
│                      │                      │                   │
└──────────────────────┴──────────────────────┴───────────────────┘
```

Cards use the CLI logo as the primary CLI identity.

Do not make the card headline simply "Claude" or "Codex".

## Kanban Status

Exactly:

```text
Idle
Working
Needs You
```

The board is automatically driven by runtime state.

## Needs You Details

Status colors are warm, muted and matte (ADR 0049): taupe for Idle, sage for
Working, ochre for Needs You. No glow; only Needs You moves, as a slow faint ring.

Status is shown by color only — no reason text on cards or pane headers
(ADR 0011). The reason (permission / input / confirmation) is kept in
tooltips and accessible labels, never as a column.

## Responsive Behavior

The desktop window should adapt gracefully.

For multiple panes:

- preserve gutters
- preserve minimum pane sizes
- allow recursive splits
- show a clear drag/drop preview
- avoid accidental pane collapse

## Motion

Fluid and premium, never heavy (ADR 0017):

- pane creation/removal
- Kanban card movement (cards glide between columns)
- menus, popovers, dialogs and toasts (spring in)
- selection: one indicator glides between tabs / settings sections
- screens, modes and sidebars fade or slide in
- drop previews
- status transitions
- theme switches cross-fade the whole window

Rules: animate only `transform` and `opacity`; use `--ease-liquid` for
movement and the `--duration-*` tokens; no `backdrop-filter` over large areas
that repaint (terminals); no per-frame JavaScript loops; respect
`prefers-reduced-motion`.

Anything a click opens or switches to (the sidebar and its rail, the side panel and its pages,
a worktree's screen, its panes and tabs) enters in `--duration-fast` with `--ease-out`, all at
once and never staggered: the window answers within a few frames (`scripts/e2e-perf.mjs`
checks four at 60 Hz). Springs and longer durations are for what floats over the app (menus,
dialogs, toasts).

Motion should clarify state, not decorate it.

## Interaction Rules

### Pane drag

```text
Normal drag
     ↓
drag toward edge
     ↓
drop preview
     ↓
dock/move
```

### Pane swap

```text
Hold Space
     ↓
drag pane over another pane
     ↓
release
     ↓
swap panes
```

### Kanban

```text
CLI runtime changes
        ↓
normalized status
        ↓
board updates automatically
```

Never:

```text
user drags card
        ↓
fake runtime status
```
