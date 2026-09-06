# Workspace layout presets

## Goal

Replace the temporary “Load presets” message in an empty workspace pane with a durable, workspace-scoped layout-preset library. Users can save their current pane arrangement, reopen it later, and edit the saved preset’s metadata or snapshot.

## User flow

The empty pane keeps two entries: **Add pane** and **Load presets**. Selecting Load presets opens one modal with two tabs.

### Load presets

The default tab lists the workspace’s saved presets. Each row shows its name, optional description, pane count, and last update time. Each row has:

- **Open**: replace the current layout with the stored layout and focus its saved focused pane when it still exists.
- **Edit**: open the edit form for that preset.

An empty library explains that a preset can be created from the current pane arrangement.

### Create preset

The create tab saves a snapshot of the current `CodePaneLayout`. It requires a name, accepts an optional description, and stores the workspace layout exactly as it exists when saved. It does not create or start terminals, agents, browser panes, or Markdown documents.

### Edit preset

Edit permits changing the name and description. It also has an explicit **Update from current layout** action that replaces the stored layout snapshot with the current workspace arrangement. Updating the snapshot is never implicit.

Preset changes and opening a preset show in-app success or error feedback.

## Storage and API

A new SQLite table stores `id`, `workspace_id`, `name`, `description`, `layout_json`, `created_at_unix_ms`, and `updated_at_unix_ms`. Presets are scoped to one workspace and are deleted with that workspace. The layout is serialized using the existing `CodePaneLayout` protocol type, so no process credentials are stored.

The desktop protocol exposes list, create, update, and open requests plus a preset summary. The application validates that the requested workspace matches the saved preset and validates the stored layout through the existing code-domain layout validation before it is saved or applied. Open updates the existing code-layout revision through the normal optimistic-concurrency path.

## UI sizing

Automation template cards are constrained to a compact readable column rather than stretching across the whole surface. Their text remains left-aligned and wraps within that column on narrower desktop windows.

## Validation

Tests will cover preset serialization, workspace scoping, create/update/open behavior, invalid-layout rejection, and renderer handling for the empty, create, load, and edit states. Renderer lint, type checking, build, and workspace Rust tests will be run after implementation.
