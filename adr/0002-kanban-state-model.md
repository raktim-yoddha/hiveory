# ADR 0002 — Three-State CLI Kanban

## Decision

The Project Kanban has exactly:

- Idle
- Working
- Waiting for You

## Rationale

The board is an operational view of live CLI state, not a project-management history board.

## Consequences

- no Done column
- no manual drag status changes
- no history column
- provider-specific waiting reasons remain metadata
