# Hiveory Session Integrations and Desktop Surfaces Design

## Objective

Replace the current split-pane plugin interface and inconsistent automation, skill, and task screens with compact desktop surfaces based on the approved reference images. Every visible control must call an existing local capability or a new local implementation. Hiveory must not display demo connections, fake execution results, or controls that imply unsupported behavior.

Plugins and skills enabled for command-line agents apply only to CLI sessions launched by Hiveory. Hiveory does not modify a CLI's global configuration.

## Design principles

- Use a near-black application canvas, dark neutral rows, subtle gray borders, white primary actions, and green, amber, or red only for state.
- Do not use blue as a general action or selection color on these surfaces.
- Keep all primary content within the desktop viewport. Lists and dialogs scroll independently without expanding the application shell.
- Use Lucide SVG icons, visible keyboard focus, labelled icon buttons, stable hover states, and announced errors.
- Preserve async state while actions run and show specific recovery guidance when an operation fails.
- The supplied screenshots override generic palette and landing-page recommendations from UI/UX Pro Max. Its accessibility, focus, keyboard, loading, and React list guidance still applies.

## Session integration architecture

Hiveory will create a temporary CLI session profile whenever it launches a supported CLI pane. The profile contains:

- enabled skill sources assigned to CLI sessions;
- enabled and validated plugin tools;
- connection identifiers, tool risk, and permission metadata;
- a random session identifier and the owning pane identifier;
- the workspace path and an expiry timestamp.

Secrets are never written into the profile. The local bridge resolves credentials from the operating-system keyring when a tool is called.

The CLI adapter launches the process with adapter-specific arguments or environment variables pointing at the profile. For CLIs that accept MCP servers, Hiveory exposes the tools through a local stdio bridge. For CLIs with native session skill paths, Hiveory materializes a temporary skill directory and passes that directory to the process. The profile and skill directory are removed after the pane process exits.

Each adapter reports a handshake state: `synced`, `partial`, `unsupported`, or `failed`. The UI must only show `Synced` after the launched process accepted the configuration. A partial or failed adapter includes a concrete reason. Unsupported adapters continue to launch, but Hiveory does not claim their plugins or skills are active.

Read-only tools can run after the plugin connection is tested and the plugin is enabled for CLI sessions. Mutating tools require an explicit per-plugin session permission. The permission is part of the generated profile and expires with the pane. Existing agent grants remain separate from CLI session access.

The first supported adapters are the CLI adapters already exposed by Hiveory: Codex CLI, Claude Code, OpenCode, and Antigravity. Each adapter receives its own integration implementation and tests; there is no generic claim that an arbitrary executable supports synchronization.

## Plugin screen

The plugin page occupies the entire content area. It contains a compact search field followed by one bordered list, matching the first reference image. The inspector column is removed.

Each row contains the provider icon or deterministic monogram, name, one-line description, state text, an enable switch, and an ellipsis button. The switch behavior is:

- disabled plugin: turning it on enables the manifest;
- enabled plugin without a connection: turning it on opens configuration;
- untested connection: configuration remains open until the connection passes a real test or the user cancels;
- validated connection: the switch enables or disables the plugin for new Hiveory CLI sessions;
- existing sessions keep their immutable session profile until they close.

The ellipsis button opens an anchored keyboard-accessible menu with Configure, Test connection, CLI session access, Agent access, Disable, and Remove for custom plugins. Configure opens a modal containing connection fields, a masked secret replacement field, allowed hosts, available tools, and permission scope. Test connection uses the current runtime test and updates the row immediately. Agent access edits existing agent grants. CLI session access controls read-only and mutating session permissions. Removing a custom plugin requires confirmation and is unavailable for built-in manifests.

Create plugin and Import manifest remain available in the page toolbar. They use the existing validated manifest and keyring-backed connection APIs.

## Skills screen

The skills page follows the second reference image: a single near-black panel with a title, a concise subtitle, and a compact full-width row list. Each row shows a file icon, name, description, trigger summary, the number of Hiveory agents using it, and the number of active or future CLI session assignments.

Selecting a row opens a modal for details and assignment. Built-in skills can be assigned or unassigned. Custom skills can also be edited and removed. The toolbar provides Create skill and Import SKILL.md. All mutations use the local skill catalog and validated SKILL.md parser.

CLI session assignment is separate from Hiveory Agent assignment. The session profile receives only skills explicitly enabled for CLI sessions. Adapter status explains whether the selected CLI can consume those skills.

## Automation screen

The automation page follows the third reference image. The top toolbar contains title, search, filters, refresh, and a white New Automation button. The main panel shows active automations when present. When empty, it shows the four real local templates and an Add new row.

Creating a template immediately opens the automation form with the template fields populated; it does not create data until Save. Configured automation rows include schedule, next run, last result, an enable switch, and an ellipsis menu for Run now, Edit, Duplicate, View executions, and Archive.

The existing local scheduler remains the source of truth. Search and filters operate on the returned routine summaries. Run now waits for the scheduler response and refreshes execution history. Failed starts display the scheduler error. Plugin tools are selectable only when their connection is validated and the selected Hiveory Agent has a matching grant.

## Tasks and Kanban

The Tasks page follows the fourth reference image with provider controls, Issues, PRs, and Projects tabs, project-source selection, query, filters, add, and refresh. Hosted data is loaded through locally installed and authenticated provider CLIs. No Hiveory server is required.

The page distinguishes provider tasks from local code-run tasks. Provider tabs show real provider results and clearly report missing CLI, missing authentication, no selected project, offline, or rate-limit states. Local code-run tasks remain available through a Local tab.

The Kanban button opens the existing full-screen board. It uses the same normalized task records as the list page. Local column overrides and pins remain in Hiveory's local settings. Dragging a provider item updates only local board organization unless a provider-specific status mutation is explicitly selected and confirmed. Opening a card routes to its provider URL or local Hiveory workspace.

## State and data flow

Renderer views fetch data through `hiveoryClient`; they do not read SQLite or credentials directly. Tauri commands coordinate local stores, keyring access, provider CLI discovery, and session profile generation. Rust services own validation and lifecycle cleanup. Renderer state updates optimistically only for reversible local preferences; provider, plugin, skill, and automation mutations update after the host confirms success.

Menus and modals close on Escape, restore focus to the triggering control, and do not close while a save is active. Errors appear in the relevant modal or row and are announced with `role="alert"`. Success messages are announced without stealing focus.

## Verification

- Renderer typecheck and production bundle build.
- Component tests for plugin switch states, ellipsis menu actions, skill assignments, automation template behavior, search/filter behavior, and task empty/recovery states.
- Rust tests for session profile creation, secret exclusion, per-pane expiry, adapter handshake states, and cleanup.
- Integration tests for plugin connection testing, agent grants, CLI session permissions, scheduler manual runs, and local board persistence.
- Adapter smoke tests for every supported installed CLI, with an explicit unsupported result where the installed version lacks the required session hook.
- Desktop checks at 1024x768 and 1440x900 for list scrolling, menu placement, modal scrolling, keyboard navigation, and absence of horizontal overflow.
- Full production build of the portable executable, NSIS installer, and MSI.

## Delivery boundary

This change remains fully local. Provider APIs can still require the user's own token or OAuth session, and provider CLIs can require their own login. Hiveory stores secrets in the OS keyring, uses existing local CLI authentication where supported, and does not ship shared service credentials.
