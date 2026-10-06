# ADR 0023 — Plugins through the user's Composio account

Supersedes the plugin part of ADR 0017 ("Plugins are local-first", the key
catalog and its inclusion rule). The gateway part of ADR 0017 stays. Builds on
ADR 0022 (bots).

## Context
ADR 0017's plugins made the user create and paste a key for every app, and left
out OAuth-only apps (Google Workspace, Microsoft 365…). The product owner
decided:
- key-based plugins are removed;
- the user signs in once to their own Composio account (free or paid plan);
- apps are connected automatically through Composio;
- every agent gets them — Work CLIs, chat and bots;
- the Plugins screen keeps its look: a searchable grid of app cards by category.

## Decision
**One Composio account per Hiveory install.**
- It is a connection with `pluginId: 'composio'` to Composio's hosted MCP
  server, `https://connect.composio.dev/mcp`.
- Its tools reach every agent through Hiveory's own MCP server and
  `McpGateway` (ADR 0017), the same way bots get them. No CLI config is written.

**Signing in.** Hiveory is a public OAuth client of the user's Composio account,
using standard MCP authorization:
- dynamic client registration and PKCE;
- the browser returns to a one-shot page on `127.0.0.1`, as in RFC 8252, and the
  `state` value is checked;
- scopes are `openid offline_access`, so tokens refresh without a new sign-in.

Hiveory is not an OAuth provider and hosts nothing. It needs no Composio API key.

**Connecting apps.**
- The grid lists curated Composio toolkits (`PLUGIN_APPS`, keyed by toolkit
  slug).
- Connect calls Composio's own `COMPOSIO_MANAGE_CONNECTIONS` tool through the
  gateway. If the app is already active, it is connected straight away;
  otherwise Hiveory opens the approval link Composio returns.
- When the window gets focus again, or the card is clicked, Hiveory asks again.
  Composio's wait tool is not relied on.
- Connected apps are recorded on the connection (`apps`). They are shown on the
  cards and named in the agent prompt next to Composio's hint. Agents can still
  connect any of Composio's 1,000+ apps on demand: its tools return a link for
  the user.

**Only a user action opens the browser.** Signing in, reconnecting and
connecting an app may open it. An agent's call never does: with no usable
token, it fails with "sign in again in Settings › Plugins".

**Secrets.**
- The registration and tokens are sealed with `SecretBox` into one
  `StoredConnection.oauth` value.
- They never reach the renderer, and token values are masked in tool output and
  errors.
- The PKCE verifier and `state` exist only in memory for one sign-in.
- Signing out deletes them. The apps stay connected in the user's Composio
  account.

**Migration.** Connections of the removed key plugins, and their saved keys, are
dropped when the state is read. Servers added by hand or imported from a CLI
stay under MCP servers.

**Logos.** Brand marks still come only from the CC0 svg-logos set. An app
without one (Google Docs, Google Sheets, Outlook, Calendly, Tavily, SerpApi, and
Composio itself) shows its initial.

**Testing.** `HIVEORY_PLUGIN_URL_COMPOSIO` points automated runs at a local
stand-in. Links may be http only for a server on this computer. The e2e run
checks:
- sign-in, and connecting an app through the approval link;
- tool calls from a Work agent and from a bot;
- a silent token refresh;
- keeping the sign-in across a restart.

## Consequences
- App data passes through Composio's cloud and counts against the user's
  Composio plan. The Plugins screen says so.
- A broad hub raises the cost of prompt injection: tools under `mcp__hiveory` are
  pre-approved (ADR 0017). Per-action approval for sending or deleting actions is a
  follow-up.
- Composio's tool output is parsed defensively: a status, or a link at any depth.
  A change on Composio's side shows up as an error on the card, not a crash.
- In client mode (ADR 0022), the browser opens on the server machine.
