# Implemented / current features

**Status:** Source-backed inventory for this checkout. Production and Dev do not expose identical capabilities. Provider, credential, local executable, and operating-system requirements can affect availability.

| Area | Reference | Scope |
| --- | --- | --- |
| Code | [Workspace and orchestration](code/README.md) | Workspaces, panes, terminals, editor/preview, source control, coding CLIs, and Code runs. |
| Chat | [Chat](chat.md) | Standalone conversations and provider-backed model responses. |
| Integrations | [Plugins and Automations](global/plugins-and-automations.md) | Declarative local integrations and scheduled workflows. |
| Workspace utilities | [Tasks, browser, and settings](global/tasks-browser-settings.md) | Task sources, embedded browser, dashboard, navigation, and settings. |
| Skills | [Skills](skills/README.md) | Local instruction-package catalog and edition-specific Agent integration. |
| Shared platform | [Platform and delivery](platform.md) | Rust host authority, storage, capabilities, lifecycle, and packaging. |

This inventory is not a promise that each provider, CLI, private Dev feature, or OS integration is configured on every machine. Use the [edition boundary](../../architecture/private-feature-boundary.md) and [architecture map](../../architecture/README.md) for ownership and trust contracts.
