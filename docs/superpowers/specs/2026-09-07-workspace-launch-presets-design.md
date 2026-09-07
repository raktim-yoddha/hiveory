# Workspace Launch Presets

## Purpose

Workspace presets are reusable startup configurations. A preset describes the panes and local sessions Hiveory should create together, so a builder can begin a repeatable multi-agent workflow in one action.

They are not saved snapshots of an already-running workspace.

## Availability

The empty-workspace launcher is the only entry point for presets. It presents exactly two choices:

- **Add pane** opens the existing pane picker.
- **Load presets** opens the preset library.

Once a workspace contains a pane, preset controls no longer appear. Empty panes created later expose only **Add pane**. A preset is therefore selected before a workspace session begins and never alters an active workspace.

## Preset model

Each preset has a required name and an ordered list of entries. There is no description field.

An entry defines one pane to create:

- a local coding-agent session, with an installed adapter, role/title, and persisted YOLO setting when supported;
- a terminal pane, with a role/title;
- a browser pane, with a validated starting URL and role/title; or
- a Markdown pane, with a role/title.

The order of entries is preserved. Hiveory derives a compact tiled layout from that order at launch. The builder may add, reorder, edit, or remove entries while creating or editing a preset. The library reports the number and kinds of panes each saved preset will open.

## Preset library

The library contains two tabs:

- **Load** lists durable presets for the selected workspace, with the full lineup, **Edit**, and **Open** controls.
- **Create** contains the name field and lineup builder. It provides an explicit **Add session** control and validates every row before saving.

Edit reopens the same builder for an existing preset. It changes the preset definition only; it cannot change a running workspace.

## Launch behavior

Opening a preset is valid only for an empty workspace. The backend validates the stored entries, derives a fresh layout, persists it with the workspace's optimistic revision, and returns the created panes. The renderer then starts terminal and coding-agent sessions, and opens browser or Markdown panes, one entry at a time through the existing launch APIs.

If an adapter is no longer installed or authenticated, the preset can still be inspected and edited, but opening it fails before any pane is created with a clear unavailable-adapter error. Invalid URLs and malformed stored definitions are rejected server-side. A layout conflict reloads the empty workspace instead of modifying an active one.

## Persistence and compatibility

New launch presets use their own durable schema and protocol types. The earlier `hiveory_code_layout_presets` records remain untouched so no existing data is deleted or overwritten. They are not shown in the new preset library because their layout-snapshot semantics are intentionally retired.

## Testing

- persistence tests cover create, query, update, workspace scoping, and stored entry order;
- application tests cover empty-workspace enforcement, adapter and URL validation, and launch layout generation;
- renderer tests cover the lineup builder, save/edit flow, and the absence of preset controls after a pane is created;
- renderer typecheck, production build, and desktop host checks must pass.
