# ADR 0003 — Presets Store CLI Configuration Only

## Decision

Presets store:

- CLI selection
- CLI instance counts
- auto-approve permission setting

They do not store pane layout.

## Rationale

Pane arrangement is Workspace state, not reusable agent configuration.

This allows the same preset to create different layouts in different Workspaces.
