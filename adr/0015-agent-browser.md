# ADR 0015 — Built-in Agent Browser

## Context
The side panel's Browser tab was a placeholder. The product owner asked for a
fast, controllable browser that every agent Hiveory launches can use ("browser
use", on by default) through the existing MCP toolkit, including when the panel
is closed. It must support dragging, annotating elements, cookies, profiles,
developer tools and device viewports with built-in pixel sizes, all configurable
in Settings.

We studied ego lite (citrolabs/ego-lite, MIT; a Chromium browser plus the
`ego-browser` skill). Its speed comes from four things, not from one trick:
1. **Fewer round trips** — the agent composes several actions in one call
   instead of "act, look, act".
2. **Compact semantic snapshots** — the page as short structured text with
   stable element refs (`@12`), viewport-scoped by default, empty wrappers
   collapsed.
3. **The next view comes with the action** — every action ends with a fresh
   snapshot, so no extra observe call is needed.
4. **An in-process browser** — no separate browser to launch or WebSocket
   bridge to keep alive; agents get their own space without stealing the user's.
It also shows a visible agent cursor with a short caption, and uses trusted
input with a DOM-event fallback.

## Decision
- **Pages live in main.** Each page is a `WebContentsView` owned by
  `BrowserService`, so it keeps running when the panel is closed or shows
  another tab. The panel only reports where to draw the active page
  (`browser.show` with bounds). A page that is not on screen is *hidden*
  (`setVisible(false)`) at its last real size. With
  `backgroundThrottling: false` it keeps rendering, reports `visible`, and
  accepts input and screenshots. Moving pages off-window does not work: Electron
  clips them to 0×0.
- **Control path:** trusted mouse/keyboard input, emulation and screenshots go
  over the page's in-process DevTools protocol (`webContents.debugger`). Page
  state goes through a script in an *isolated world*, which page code can
  neither see nor tamper with: snapshots, ref resolution, the cursor, and
  picking. Console and network logs come from Electron events, not CDP
  `Runtime`/`Network` domains, which bot detection can see.
- **Tools (MCP):** `browser_navigate`, `browser_snapshot`, `browser_click`,
  `browser_hover`, `browser_drag`, `browser_fill`, `browser_press`,
  `browser_select`, `browser_scroll`, `browser_wait`, `browser_screenshot` (MCP
  image content plus a file), `browser_evaluate`, `browser_batch` (many steps in
  one call, stopping at the first failure), `browser_pages`, `browser_viewport`,
  `browser_cookies`, `browser_console`, `browser_network`, `browser_annotations`,
  `browser_profiles`, `browser_devtools`. Actions return a fresh snapshot by
  default. They ride on the existing agent-tools MCP server, scoped to the
  calling agent's workspace.
- **Code-based batching is declarative.** ego runs agent-written JavaScript in
  Node; Hiveory's `browser_batch` takes a JSON list of steps instead.
  Agent-written code runs only inside the page (`browser_evaluate`, sandboxed by
  Chromium), never in Hiveory's main process.
- **Agent pages are visible.** A page an agent opens joins its workspace's side
  panel as a tab named after the agent ("Milo · GitHub"), with a "Milo is using
  this page" strip. Each agent has a current page, auto-created on first use;
  popups open as new pages beside their opener.
- **Profiles** are persistent session partitions (`persist:hv-browser-<id>`)
  with separate cookies and storage. The default profile always exists. Cookies
  import from and export to JSON (Cookie-Editor, Playwright `storageState`) or
  Netscape cookies.txt. Hiveory does not decrypt another browser's cookie store:
  Chrome's app-bound encryption exists to stop exactly that.
- **Annotate / pick:** the user picks an element in the page. *Pick* copies
  its description (ref, selector, HTML) for pasting to an agent. *Annotate*
  attaches a note that agents read with `browser_annotations`.
- **Viewports:** seven built-in sizes (Mobile S 320×568 … Desktop 1920×1080)
  plus custom sizes from Settings. Below 768 px wide, touch and a mobile user
  agent are emulated, scaled down to fit the panel.
- **Native view vs. menus:** the page draws above the app, so while any menu or
  dialog is open the page steps aside and leaves a picture of itself behind.
- **Settings › Browser:** browser use on/off (default on), agent cursor on/off
  (off is slightly faster), home page, default profile, profile management
  (rename, import/export/clear cookies, delete) and custom viewport sizes. Pages
  are not persisted across restarts; profiles (and their logins) are.
- **User agent:** pages present as plain Chrome; the `Electron/…` and app
  tokens are removed because sites block them.

## Routing website requests to the browser
Advertising the tools is not enough: CLIs reach for their own fetchers or
browsers first. When browser use is on, every agent Hiveory launches, terminal
or chat, is set up as follows (per launch only; the user's own CLI config is
never edited):
- **Instructions.** Every CLI gets the same instruction (`BROWSER_PROMPT`): for
  any website or URL, use the `browser_*` tools, not WebFetch, curl or web
  search. Claude gets it through `--append-system-prompt`, Codex through
  `-c developer_instructions`, and the rest through MCP server instructions.
- **Claude Code:** `WebFetch` is disallowed. Web search stays available.
- **Codex:** its built-in browser and computer-use features and the bundled
  browser plugins (`browser`, `chrome`, `computer-use`, `unified-computer-use`,
  which provide the `cua_repl` server) are turned off. Hiveory's MCP server is
  pre-approved (`default_tools_approval_mode="approve"`); headless `exec` runs
  refuse unapproved MCP calls.
- **Chat runs** (Chat mode and chat-view Work agents) load Hiveory's MCP server
  too: Claude, Codex, OpenCode, Kilo and Copilot. A plain Chat-mode chat gets
  the browser tools only. Its pages belong to the chat's project.

## Consequences
- Pages are ephemeral; agents reopen what they need after a restart.
- Cross-origin iframe content is listed but not walked (actions there use
  coordinates or screenshots). Same-origin iframes and open shadow roots are.
- Page permissions (camera, location…) are denied except fullscreen and
  clipboard writes.
