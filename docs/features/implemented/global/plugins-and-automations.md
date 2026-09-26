# Plugins and Automations

**Status:** Local integrations and schedules are part of the product surface. Actual provider calls and Agent-bound execution depend on configuration and edition.

## Plugins

The renderer surface is `src/apps/renderer/src/features/global/plugins/views/HiveoryPlugins.tsx`; host execution and validation live in `src/crates/global/plugins/hiveory-plugin-runtime/src/`, with persistence under `src/crates/core/hiveory-persistence/src/`. Host-owned declarative HTTP and secret handling are described in [the foundation architecture](../../../architecture/hiveory-foundation.md) and [security threat model](../../../security/threat-model.md). A saved connection alone does not prove a tool is granted or runnable.

## Automations

The Automations UI is `src/apps/renderer/src/features/global/automations/views/HiveoryRoutines.tsx`; scheduler ownership is in `src/crates/global/automations/hiveory-routine-scheduler/src/`. Agent-driven execution requires the Dev/private runtime described in [the edition boundary](../../../architecture/private-feature-boundary.md). Do not claim Production executes these routines as Hiveory Agent runs merely because schedule and scheduler code exists.

Provider API, credentials, rate limits, network access, and local scheduler availability remain environment-dependent. See the [user manual](../../../user-manual.md) for product usage and verify current source status when manual text differs from this page.
