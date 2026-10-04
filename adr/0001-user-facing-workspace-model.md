# ADR 0001 — Workspace Is the User-Facing Development Unit

## Decision

The application does not expose a separate user-facing Task object.

Workspace is the development unit.

A Workspace may contain zero or more CLI agent instances.

## Rationale

The product needs a simple mental model:

```text
Project
  └── Workspace
       ├── CLI
       ├── CLI
       └── CLI
```

Git branch/worktree details remain implementation details.

## Consequences

- no Task creation flow
- no nested Tasks inside Workspaces
- Project Kanban is a view of CLI instances
- Workspace creation owns its Git isolation
