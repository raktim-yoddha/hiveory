# ADR 0004 — Reusable Components and Services

## Decision

All repeated UI and behavior must be implemented through reusable components/services.

Provider-specific code is isolated behind adapters.

## Consequences

The application should avoid:

- duplicated modal implementations
- duplicated CLI launch code
- provider-specific Kanban cards
- Git calls from React
- giant screen components
