# ADR 0017 — Plugins, Hiveory MCP Servers, Skills Management, Wallpapers and Motion

Builds on ADR 0012 (agent tools over MCP), ADR 0015 (browser) and ADR 0016.

## Plugins and MCP servers: one gateway
**Decision.** Hiveory serves extra MCP servers to agents *through its own MCP
server*. That server is already injected into every agent it launches: Work
CLIs that load MCP and every Chat run. A plugin's tools reach all of them as
`hiveory` tools named `<app>_<tool>` (e.g. `github_create_issue`).

**Why.**
- No CLI config is written, and no per-CLI syntax is needed for each server.
- Secrets never go on a command line or into a CLI's files.
- Approvals are already granted for `mcp__hiveory`.

**How.**
- `McpGateway` is a `ToolFamily`, using the official MCP SDK client: stdio via
  cross-spawn, Streamable HTTP, and SSE as a fallback for older servers.
- Servers start on the first call, are shared by every agent, and stop after
  10 minutes idle.
- The tool list is cached in state, so listing tools never starts a process.
- Agents are told which apps are connected in their system prompt.
- With coordination tools off, the Hiveory MCP server still carries browser,
  computer use and apps.

**Plugins are local-first.** *(Superseded by ADR 0023: plugins now run through
the user's own Composio account; the key catalog below is removed.)* There is no OAuth, Hiveory account or hosted
relay. A plugin is a catalog template (`src/shared/domain/plugins.ts`) filled
with keys the user creates:
- a local `npx` / `uvx` server fed by environment variables; or
- the vendor's official remote endpoint with `Authorization: Bearer <key>`.

**Inclusion rule.** An app is listed only if:
- its server works with a key the user can create themselves; and
- its exact brand mark exists in the CC0 svg-logos set. Marks are embedded
  from `@iconify-json/logos`, so a guessed logo is impossible.

Market check: the overlap of Claude connectors, AgentPort, BridgeSpace and
similar tools gave 30 plugins:
- Code: GitHub, GitLab, Sentry, CircleCI, Heroku, Figma.
- Work: Linear, Notion, Jira & Confluence, Slack, Email (Resend), Trello,
  Todoist, Obsidian.
- Data: Supabase, Neon, PostgreSQL, MongoDB, Airtable.
- Business: Stripe, HubSpot, PostHog.
- Search: Brave, Perplexity, Exa, Firecrawl.
- Media: Hugging Face, ElevenLabs.
- Automation: n8n (self-hosted MCP), Zapier.

OAuth-only apps are left out: Google Workspace, Microsoft 365, Vercel, Asana
and Intercom. Apify and Tavily are left out because they have no verified
logo.

**Secrets.**
- Values are sealed with Electron `safeStorage` (DPAPI, Keychain or libsecret)
  before they reach `state.json`. They are only encoded where no keychain
  exists.
- They are write-only from the renderer: views carry the names of saved values,
  never the values.
- An empty field keeps the stored value.
- Plugin URLs that embed a key (Zapier) are redacted in views.
- "Where to get your key" links go through `system.openUrl`, which only allows
  catalog key pages and the Node/uv install pages.

**MCP servers tab.**
- *In Hiveory*: servers added by hand (a command or a URL, with env vars or
  headers), served to every agent.
- *In your CLIs*: the read-only scan as before. "Every agent" copies a server's
  full config into Hiveory, with its secrets sealed. The CLI's own file is
  untouched.

## Skills management
- Skills are grouped by folder name across the four skills folders: `.agents`,
  `.claude`, `.codex` and `.cursor`.
- Each folder is a toggle:
  - lighting one copies the skill there, so every CLI reading that folder loads
    it;
  - turning one off moves that copy to the OS trash (confirmed, recoverable).
- New skill writes `SKILL.md` into the chosen folders, in the user or the
  project scope.
- Import copies a chosen skill folder in.
- All writes are explicit user actions; CLI config files are still only read.

## Appearance
- **Themes.** Six themes, always three per row: Dark, Bronze and Silver, plus
  Midnight (ink-blue), Jade (obsidian green) and Rose (plum with rose gold).
  Only colors differ.
- **Theme switch.** The whole window cross-fades once via
  `document.startViewTransition`. This is one composited snapshot, not
  per-element transitions.
- **Wallpaper.** None, six CSS presets (no downloads), or any image the user
  adds.
  - Images are copied into `userData/wallpapers`: JPEG/PNG wider than 2560 px
    are scaled down and get a 480 px thumbnail; formats the codec can't read
    are kept as they are.
  - They are served only through the `hv-wallpaper://img/<file>` scheme, which
    is limited to that folder.
- **Transparency.** Themes set opaque `--base-*` surfaces. Components use
  `--color-surface*`, which are `color-mix(base, transparent)` with
  `--surface-alpha`.
  - Raised and interactive layers keep more opacity; dialogs stay solid.
  - Terminals turn their background transparent, so the pane's tint shows
    through.
  - The wallpaper is one fixed layer, blurred and dimmed once and cached by the
    compositor. There is no `backdrop-filter` on panels.
  - Over a wallpaper the native window controls overlay is transparent.
- **Logo.** In the app the mark is flat. The icon file's bevel rim and shadow
  are clipped off, and the brand name is plain text.

## Sidebars
Dragging a sidebar edge past 60% of its minimum width hides the sidebar, like
VS Code. The same goes for arrowing below the minimum. Showing it again restores
the last real width.

## Motion and performance
**More motion, compositor-only.** Every animation uses transform and opacity,
with one liquid curve (`--ease-liquid`):
- one gliding indicator for tabs and the settings nav (`useSelectionBox`);
- screens, modes and sidebars rise or slide in, and CSS animations restart when
  a hidden mode is shown;
- Kanban cards glide between columns (`useFlip`, one WAAPI animation per moved
  card);
- springy menus, popovers, dialogs and toasts;
- tactile button presses and a stretching toggle knob;
- staggered list and card entrances;
- chat turns rise in.

`prefers-reduced-motion` turns them off.

**Less work.**
- The browser panel no longer runs a rAF loop forever. It re-measures on resize,
  layout and animation events, with a 500 ms safety poll.
- Chat messages are memoized, so a streaming message no longer re-renders and
  re-parses every Markdown message.
- Off-screen chat turns use `content-visibility: auto`.
- The dialog backdrop blur was removed: it was recomputed on every terminal
  frame behind it.
- Plugin servers run only while used.

## Consequences
- Running agents see a newly connected plugin's tools when their MCP session
  next lists tools, usually when the agent starts. Removing a plugin takes its
  tools away immediately.
- CLIs without MCP injection (Gemini, Cursor, Qwen, Amp) do not get plugins
  yet.
- `npx -y` downloads a package the first time a plugin runs, so the connect
  timeout is 120 s.
