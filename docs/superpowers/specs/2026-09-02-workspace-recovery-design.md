# Workspace recovery and terminal lifecycle design

## Goal

After a normal Hiveory restart, return the user to the same Code workspace, section, and persisted pane layout they used before closing the application. Browser panes must open reliably, workspace removal errors must remain readable, and live terminals must reconnect without being incorrectly marked ended.

## Scope

- Persist the active Code workspace and Code section as application settings.
- Restore that context only when the workspace remains available; otherwise select the first available workspace.
- Preserve the existing per-workspace pane-layout persistence as the source of truth for pane structure.
- Make native browser child-webview creation safe against the main-window lifecycle and expose actionable errors.
- Normalize structured Tauri failures in the renderer so UI never displays `[object Object]`.
- Reconcile persisted terminal records with the terminal host; never mark every terminal dormant merely because the host starts.

## Non-goals

- Restarting a terminal process that was explicitly stopped or naturally exited.
- Restoring an external browser page after its workspace was removed.
- Persisting arbitrary browser cookies or page state beyond the existing profile model.
- Changing the terminal-history encryption policy.

## Durable state ownership

`hiveory_settings` will store a versioned Code-context value containing:

```json
{
  "workspace_id": "workspace UUID",
  "section": "workspace"
}
```

The desktop host owns validation and persistence of the selected workspace. The renderer may request a selection change, but startup reads the validated host value from `CodeSnapshot`. This prevents a renderer refresh from selecting a sorted-first workspace instead of the user’s last workspace.

When a workspace or project is removed, the host atomically changes the active workspace to a valid remaining workspace (or `null`) and overwrites the saved Code context. The renderer then reloads the snapshot instead of retaining a stale identifier.

## Browser lifecycle

Browser panes use a native child webview. Creation, replacement, and closure must be serialized through a single browser-manager operation tied to the main application window. A request will:

1. Reuse the existing browser resource when its workspace and profile match.
2. Create the child webview only after the main window is available and on its UI-safe execution path.
3. Publish the resource only after construction and page-message wiring succeed.
4. Remove partial state when construction fails, then retry once for a transient main-window readiness failure.

The renderer will retain the returned structured failure and present its message. A failure will therefore identify the missing window, profile problem, unsupported URL, or embedded-webview failure instead of the generic browser notice.

## Structured client errors

The renderer API client will expose one error-normalization helper. It accepts `Error`, Tauri’s serialized `{ code, message, retry }` object, strings, and unknown values. It returns the meaningful message plus optional code for diagnostics. All Code workspace and project removal paths, Browser pane startup, and terminal recovery actions will use this helper.

## Terminal lifecycle and relaunch

The hidden terminal host is the authority for a terminal’s liveness. On host start it must not change all persisted `starting` or `running` terminal rows to `dormant`. Instead it will load persisted terminal identities and reconcile each one:

- A terminal that the host owns and can attach to remains active.
- A terminal whose backing process is verifiably absent is recorded as exited/dormant with a concrete reason.
- A persisted terminal awaiting host reattachment remains reconnectable until reconciliation completes.

The desktop host and renderer use the stable terminal ID to subscribe, fetch a snapshot, and resize only after the terminal is attached. Relaunch is guarded against duplicate launch attempts. It reconnects a recoverable terminal before creating a new process; a new process is created only after the host confirms that no live terminal exists for that ID.

This follows the Orca reference principle of hydrating identities before attachment, delaying reattachment until actual dimensions are available, and deduplicating concurrent recovery work.

## Failure handling

- A missing saved workspace falls back predictably and updates the saved context.
- A failed browser construction leaves no orphaned native child or stale browser entry.
- A failed delete operation leaves the workspace selection unchanged and displays the normalized backend message.
- A terminal-host transport failure triggers bounded reconciliation/reconnect; it does not immediately label the session interrupted.
- Explicit user stop, process exit, and unrecoverable host loss remain visible as terminal-end states with a working relaunch action.

## Verification

Automated coverage will include:

1. Save a non-default workspace/section, reopen the desktop host, and assert the same context and pane layout are selected.
2. Remove a secondary workspace and a primary project while forcing backend errors; assert readable messages rather than `[object Object]`.
3. Open a Browser pane during startup and after a remount; assert exactly one native resource and actionable errors on failure.
4. Start a terminal, close and reopen the app, reconnect it by stable ID, and verify no dormant/interrupted state is written while its host/process is healthy.
5. Force a genuinely ended terminal and verify the relaunch action succeeds once without duplicate terminal creation.

Manual packaged-app verification will cover close/reopen, workspace switching, Browser pane launch, secondary workspace removal, primary project removal, and terminal reattach/relaunch on Windows.
