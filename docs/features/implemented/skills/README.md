# Skills catalog and Agent skill use

**Status:** The Skills catalog is public; Agent execution is edition-specific. Do not treat catalog management as proof a runtime consumes a package.

The public renderer catalog is `src/apps/renderer/src/features/global/skills/views/HiveorySkills.tsx`. Skill domain/catalog contracts are in `src/crates/modes/agent/hiveory-agent-domain/src/` and `src/crates/modes/agent/hiveory-agent-runtime/src/`. Public compatibility contracts are not the same as Production Agent execution.

Production keeps Agent execution unavailable. Dev can load the private Agent runtime through the explicit Dev build path; skill execution/assignment claims must be bounded to the current Dev implementation and not generalized to Production. See [private Dev boundary](../../../architecture/private-feature-boundary.md) and [Agent foundation](../../../architecture/hiveory-foundation.md).

For durable tool and permission boundaries, see the [security threat model](../../../security/threat-model.md). For the separate Code-run scheduler, see [Code orchestration](../code/README.md) and [orchestration architecture](../../../architecture/code-orchestration.md).
