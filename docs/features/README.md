# Hiveory feature reference

This tree is the source-backed inventory of user-visible Hiveory behavior. It complements the [architecture map](../README.md) and [root README](../../README.md). It documents this checkout's production and Dev editions; do not copy edition claims from another Hiveory checkout without checking this repository's source.

## Status and navigation

- [Implemented / current](implemented/README.md) summarizes capabilities present in this checkout. Availability can differ by edition, local configuration, provider, and operating system.
- [Planned / proposed](planned/README.md) contains only explicit, uncommitted proposals. Historical phases and dated specifications are not a roadmap.

Implemented pages:

- [Code workspace and orchestration](implemented/code/README.md)
- [Chat](implemented/chat.md)
- [Plugins and Automations](implemented/global/plugins-and-automations.md)
- [Tasks, browser, and settings](implemented/global/tasks-browser-settings.md)
- [Skills](implemented/skills/README.md)
- [Shared platform and delivery](implemented/platform.md)

## Evidence rules

1. Cite repository-relative source paths for user-visible claims. Current source outranks a test or historical document alone.
2. Distinguish production, Dev/private, unavailable, planned, unknown, and environment-dependent behavior. A protocol type, UI control, compatibility receiver, or historical proposal does not prove a capability ships.
3. Verify cross-layer behavior across renderer, typed API, host command, service, persistence, and tests where the claim crosses those boundaries.
4. Link to the owning architecture, protocol, persistence, security, or build contract instead of duplicating it.
5. Never infer current behavior from the separate `Hiveory hub/hiveory` checkout. It informed this directory structure; this repository's source determines its content.

## Maintenance

When behavior changes, update the impacted implemented page and this navigation if status or ownership changes. Update root README and owning architecture/security/protocol documents when their contracts require it. Keep proposals uncommitted and prioritize only source-backed gaps. When a proposal ships, promote it to implemented status and remove it from planned in the same change. Run `pnpm audit:references` after documentation changes.
