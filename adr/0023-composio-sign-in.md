# ADR 0023 — Plugins through the user's Composio project

Supersedes the plugin part of ADR 0017 ("Plugins are local-first", the key
catalog and its inclusion rule). The gateway part of ADR 0017 stays. Builds on
ADR 0022 (bots).

## Context
ADR 0017's plugins made the user create and paste a key for every app, and left
out OAuth-only apps (Google Workspace, Microsoft 365…). The product owner
decided:
- key-based plugins are removed;
- apps connect through Composio, using the user's own project (free or paid
  plan);
- there is no Composio login. Connect goes straight to each app's own sign-in;
- an app can hold several accounts, each with a label;
- every agent gets them — Work CLIs, chat and bots.

Composio needs a credential, and three options were weighed:
- **the user's own project API key, pasted once — chosen.** No backend, no
  shared secret, and each user's usage is on their own plan;
- a Hiveory key on a Hiveory server — needs hosting, user accounts and billing;
- a Hiveory key shipped in the app — rejected: anyone could extract it and act
  on every user's connected accounts.

## Decision
**The key.**
- Settings › Plugins asks once for a Composio project API key.
- Saving it starts a tool-router session (`POST /tool_router/session`), which
  also proves the key works. The session has user id `hiveory` and multi-account
  and connection management on.
- The key is sealed with `SecretBox` as the `x-api-key` header of one connection
  (`pluginId: 'composio'`) to the session's MCP URL. It never reaches the
  renderer and is masked in tool output.

**Agents.** The session's MCP server is served to every agent through
Hiveory's own MCP server and `McpGateway` (ADR 0017), the same way bots get it.
Agents are told which apps have an active account. They can still connect any of
Composio's 1,000+ apps on request: its tools return a link for the user.

**Connecting apps.**
- Connect calls `POST /tool_router/session/{id}/link` with the app's toolkit,
  plus `alias` for an extra account's label. Hiveory opens the `redirect_url`,
  which is the app's own sign-in page.
- Accounts come from `GET /connected_accounts`. Hiveory reads them when the
  screen opens, when the window regains focus and after each action. Only id,
  app, label and status leave main; Composio's account state, which can hold
  credentials, does not.
- Disconnect calls `DELETE /connected_accounts/{id}`, and only for an account
  of this user.
- If Composio has deleted the session, Hiveory starts a new one.

**User id.** `hiveory` is enough because the project is the user's own. Every
Hiveory install on that project shares its accounts.

**Migration.** Connections of the removed key plugins, and their saved keys, are
dropped when the state is read.

**Logos.** Brand marks still come only from the CC0 svg-logos set. Apps without
one show their initial.

**Testing.** `HIVEORY_COMPOSIO_API` points automated runs at a local stand-in.
Links may be http only for a server on this computer. The e2e run checks:
- the key being rejected, then accepted;
- Connect going straight to the app's page;
- a second, labelled account;
- Disconnect;
- tool calls from a Work agent and from a bot;
- keeping everything across a restart.

## Consequences
- App data passes through Composio's cloud and counts against the user's
  Composio plan.
- A broad hub raises the cost of prompt injection: tools under `mcp__hiveory` are
  pre-approved (ADR 0017). Per-action approval for sending or deleting actions is a
  follow-up.
- In client mode (ADR 0022), the browser opens on the server machine.
