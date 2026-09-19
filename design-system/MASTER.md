# Hiveory Graphite Design System

This is the canonical visual contract for the Hiveory renderer. Dashboard and Plugins are the approved reference surfaces. Page-specific styling may refine layout, but must not override this contract.

## Foundations

Use the renderer tokens from `app/styles/design-system.css` exclusively. The approved graphite palette is intentionally hue-neutral: canvas `#0d0d0d`, surface `#111111`, raised surface `#1b1b1b`, interactive surface `#202020`, hover `#272727`, borders `#242424` / `#303030` / `#3a3a3a`, and text `#f4f4f4` / `#a7a7a7` / `#737373`. Silver `#d6d6d6` is used for primary actions, links, active indicators, and focus. Blue and other chromatic accent colors are forbidden for interface chrome. Green, amber, and red communicate semantic status only.

Use the 4, 8, 12, 16, 24, and 32px spacing scale. Page titles are 24px/30px/700, section headings 15px/21px/600, body text 13px/20px/400, labels 11px/16px/600, and metadata 10px/14px/500. Controls, cards, and dialogs use 8px, 10px, and 12px radii. Use 36px standard controls, 30–32px compact controls, and 44px touch targets.

## Hierarchy and density

There are exactly two densities. `standard` is required for global pages and all Settings pages: 32px desktop page gutters, a page title and optional subtitle, 24px section separation, and 16px internal card padding. `compact` is for Code, terminals, Chat/Agent utility areas, and Coordination: it retains the same typography and colors with 12px section spacing and 8–12px internal padding.

Every Settings row places its label and optional description at the start edge with its state or control aligned to the end edge. At narrow widths, rows stack and controls expand to full width. Group settings by titled sections and restrained dividers, never nested-card clutter.

## Controls and states

Use shared `HiveoryButton`, `HiveoryIconButton`, `HiveoryPageHeader`, and `HiveoryDialog` primitives wherever they fit. Buttons have only `primary`, `secondary`, `ghost`, and `danger` intents, with `standard`, `compact`, or `icon` sizes. Primary actions are silver; destructive styling is only for destructive operations. Generic controls are never pill-shaped; pills identify compact semantic badges only.

All interactive controls must be keyboard reachable, have a visible 2px silver focus ring, communicate disabled/loading/error states in text as well as color, and use 120–180ms color/opacity transitions. Respect `prefers-reduced-motion`. Layering is: content 0, sticky controls 10, panels 20, modal backdrop 40, modal 50, toast 60.

## Guardrails

Run `pnpm design:check`. New CSS or renderer code may not add raw color, typography, spacing, radius, `!important`, or duplicate token-root values outside documented token and semantic-status exceptions. The check also rejects blue, cyan, indigo, violet, and purple visual values across the renderer. The three pre-existing renderer style sources are transitional compatibility sources: they may only be altered to replace legacy values with shared tokens or remove rules, while new visual work belongs in `design-system.css` and shared primitives.
