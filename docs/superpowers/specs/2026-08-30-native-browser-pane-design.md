# Native Single-Pane Browser Design

## Goal

Make the existing Code workspace preview a functional embedded browser. It must load localhost and normal HTTP/HTTPS pages, use Google for plain-text searches, and keep one browser pane per workspace without browser-internal tabs.

## Design

- Replace the iframe preview with a native Tauri child webview. This avoids sites that reject iframe embedding and supports ordinary browser navigation.
- Keep the existing `preview` layout kind and persisted preview records for compatibility. The renderer will expose browser runtime state separately from the persisted URL summary.
- Create and manage the native webview from the Tauri host. Its bounds and visibility follow the React pane, and it is closed when the pane is removed or the app exits.
- Store browser cookies and site data in a dedicated persistent webview profile, separate from Hiveory’s application database and renderer storage.
- Use a shared address normalizer: explicit HTTP/HTTPS URLs load directly; local hosts default to HTTP; hostname-like entries default to HTTPS; other text becomes a Google search.
- Allow only HTTP and HTTPS navigation. Reject credentials and unsafe schemes. Route page-initiated new-window requests to the same browser pane, preserving the single-pane requirement.
- Surface page load, title, current URL, navigation availability, errors, and download completion/failure through the browser bridge. Save downloads in the user’s Downloads directory.

## Compatibility and scope

Existing Code workspace preview commands remain valid and will open the native browser. The older Code screen will use the same behavior instead of rendering a separate iframe. No database migration or application version bump is required. The initial implementation targets the Windows executable and the installed Tauri 2.11.5 runtime.

## Verification

Unit tests cover URL normalization, unsafe schemes, state transitions, and compatibility. Windows verification covers localhost, Google searches, iframe-blocking HTTPS sites, in-page links, back/forward/reload, resize/hide behavior, persistent sessions, same-pane popups, and downloads.
