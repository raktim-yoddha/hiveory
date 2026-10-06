# ADR 0023 — Sign-in plugins: Composio

Builds on ADR 0017 (plugins through one gateway) and ADR 0022 (bots).

## Context
ADR 0017 lists only plugins set up with a key the user creates. That leaves out
OAuth-only apps (Google Workspace, Microsoft 365…) and makes users paste one key
per app. The product owner asked for a one-time Composio setup: the user signs in
with their own Composio account (free or paid plan), and every agent — Work CLIs,
chat and bots — gets its apps.

## Decision
**Composio is a plugin like the others, with a sign-in instead of a key.**
- The catalog entry (`src/shared/domain/plugins.ts`) has `auth: 'oauth'`, no
  fields, and Composio's hosted MCP server: `https://connect.composio.dev/mcp`.
- Its tools reach every agent the same way as every plugin: through Hiveory's own
  MCP server and `McpGateway` (ADR 0017). Bots get them through the same route,
  so no per-CLI config is written.
- The existing key-based plugins stay as they are. Composio is added next to them.

**Hiveory is still not an OAuth provider, and still runs nothing hosted.** It is a
public OAuth client of the user's Composio account (standard MCP authorization):
- dynamic client registration and PKCE;
- the browser returns to a one-shot page on `127.0.0.1`, as in RFC 8252, and the
  `state` value is checked;
- scopes are `openid offline_access`, so tokens refresh without a new sign-in.

Composio holds the tokens of the apps the user connects there. When an agent first
needs an app, Composio's tools give it a connect link for the user to approve.

**Only a user action signs in.** Connecting, reconnecting or turning the plugin on
may open the browser. An agent's call never does: if it has no usable token, it
fails with "sign in again in Settings › Plugins".

**Secrets.**
- The registration and tokens are sealed with `SecretBox` into one
  `StoredConnection.oauth` value.
- They never reach the renderer, and token values are masked in tool output and
  errors.
- The PKCE verifier and `state` exist only in memory for one sign-in.
- Removing the plugin deletes them.

**Inclusion rule, extended.** ADR 0017's rule is unchanged for key plugins. A
sign-in plugin is allowed when it is a hub the user signs in to with their own
account, through standard MCP OAuth. The CC0 set has no Composio mark, so its tile
shows the initial instead of a guessed logo.

## Consequences
- Data from apps connected through Composio passes through Composio's cloud and
  counts against the user's Composio plan. The setup dialog says so.
- A broad hub raises the cost of prompt injection: tools under `mcp__hiveory` are
  pre-approved (ADR 0017). Per-action approval for sending or deleting actions is a
  follow-up.
- In client mode (ADR 0022), the sign-in opens a browser on the server machine.
