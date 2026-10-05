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
graphite with brushed-silver accents; **Midnight** — ink-blue graphite with steel
highlights; **Jade** — obsidian green with jade accents; **Rose** — plum graphite
with rose gold. Saturated color only for status. Component fills are `--fill-*`
tokens so a theme can flatten them (ADR 0011, 0012, 0013, 0017).

Every theme is flat: solid colors only — no gradients, sheen or textures. Containers
have no resting outline; a border appears only on hover, focus or selection, and a
pane's header shares its body's surface (no dividing line) (ADR 0018).

Selection is a tinted fill, never an outline: selected chips, option cards and "on"
badges use `--fill-accent-soft` with `--color-accent` text or check, which reads in every
theme. A border is reserved for keyboard focus and the active pane (ADR 0018).

Themes set opaque `--base-*` surfaces; components use `--color-surface*`, which
become translucent over a wallpaper — one `--surface-alpha` for every surface. Dialogs use
`--color-surface-solid`. Third-party brand marks sit on `--color-logo-tile`.
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

## Queen Bee

One bar and one reply card, no history (ADR 0019).
- **The bar:** the mark, the input, a dock/float toggle and ⋯. It's flat and outlined
  only while focused.
- **Docked:** the bar shares the main area's surface. The card hovers above the panes on
  a solid raised surface with the popover shadow; it never pushes them. Replies fade
  out after 10 s (20 s with Undo) unless hovered; questions stay.
- **Floating:** it uses a solid raised surface and the popover shadow, so terminal text never shows through.
- **Receipts:** small, secondary text with an accent check.
- **Report rows:** status dot, name, CLI and workspace, wait time.
- **An agent's own words:** an inset block captioned "On its screen", mono text, so it is
  never mistaken for Queen Bee's.

## Dropdowns

Every dropdown is the shared `Select`: a themed listbox (keyboard, type-ahead, groups,
`size="sm"` for toolbars). Never ship a native `<select>` — its popup is drawn by the OS
and ignores the theme. Menus, popovers and listboxes opened inside a modal dialog are
portaled into that dialog, and the in-app browser page steps aside while any is open.

All icon buttons require accessible labels/tooltips.

## Sidebar

The left navigation is a single Projects sidebar in Workspace mode.

It contains:

- Projects heading
- sort control
- add/create/open project control
- project list

The sidebar should feel like the BridgeMind reference: compact, dark, subtle, and not visually heavy.

## Top-Level Navigation

Exactly two modes, labelled (ADR 0012):

```text
Work | Chat
```

The title bar also holds the side-panel toggle (terminals and the built-in browser) and the
app Settings gear. Development builds show an inverted DEV chip after the name.

Do not add Agent mode.

Do not add additional top-level modes.

## Project Page

The Project page is project-level.

Conceptual layout:

```text
┌───────────────────────────────────────────────────────────────┐
│ Project name                                      Settings    │
├───────────────────────────────────────────────────────────────┤
│ Tasks     Pull Requests     Workspaces     Settings           │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                   PROJECT CONTENT                              │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

Do NOT show:

- Open agent
- Load preset

on this page.

## Empty Workspace

An empty Workspace is different.

```text
┌───────────────────────────────────────────────────────────────┐
│ Workspace 1                                    [ ... ]        │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                    Empty Workspace                            │
│                                                               │
│                 [ Open agent ]                                │
│                 [ Load preset ]                               │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Workspace Agent Panes

When populated:

```text
┌───────────────────────────────────────────────────────────────┐
│ Workspace 1                                                   │
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

There is no Workspace header bar above the panes (ADR 0011).

Avoid unnecessary text.

## Kanban

The Project's Task view is a three-column board:

```text
┌─────────────────────────────────────────────────────────────────┐
│ Tasks                                                           │
├──────────────────────┬──────────────────────┬───────────────────┤
│ IDLE                 │ WORKING              │ WAITING FOR YOU   │
├──────────────────────┼──────────────────────┼───────────────────┤
│ ┌──────────────────┐ │ ┌──────────────────┐ │ ┌───────────────┐ │
│ │ [logo] Milo      │ │ │ [logo] Luna      │ │ │ [logo] Kai    │ │
│ │ Workspace 1      │ │ │ Workspace 2      │ │ │ Workspace 1   │ │
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
Waiting for You
```

The board is automatically driven by runtime state.

## Waiting for You Details

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
