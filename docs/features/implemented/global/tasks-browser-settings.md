# Tasks, browser, dashboard, and settings

**Status:** Shared renderer surfaces with workspace, provider, and native-runtime dependencies.

- **Tasks:** The UI is `src/apps/renderer/src/features/global/tasks/views/HiveoryTasks.tsx`; task-source adapters and host commands live under `src/apps/desktop/src-tauri/src/application/platform/`. Provider availability and credentials vary by source. See [source intelligence](../../../architecture/source-intelligence.md).
- **Browser:** Browser surfaces are used inside Code workspaces. Renderer components and coordination live under `src/apps/renderer/src/features/global/browser/`; host-side platform behavior lives under `src/apps/desktop/src-tauri/src/application/platform/browser.rs`. See [terminal pane workspace](../../../architecture/terminal-pane-workspace.md) and [security threat model](../../../security/threat-model.md).
- **Dashboard, navigation, and settings:** Renderer owners are under `src/apps/renderer/src/features/global/` and `src/apps/renderer/src/app/shell/`. Settings do not elevate host trust; native operations remain host-validated.

For interaction and setup steps, see the [user manual](../../../user-manual.md). For renderer hierarchy and shared tokens, see the [design system](../../../design-system/README.md).
