# ADR 0063 — CLI logins come from the saved environment

Builds on ADR 0006 and 0050. Decided by the product owner, 2026-11-09.

## Context

A process keeps the environment it started with. Hiveory had been started from a shell that still
held an old API proxy (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`) the user had
since removed. Every agent inherited it, so Claude Code used that token and model instead of its own
login, and showed "API Usage Billing" or "Not logged in", while the same CLI in a fresh terminal
worked. Any CLI that reads a key, endpoint or config folder from the environment can fail the same
way.

## Decision

- Before Hiveory starts any local process (agents, chats, terminals, CLI probes and the terminal host),
  each **login variable** is taken from the user's saved environment: the Windows user and machine
  variables (`reg query`, user over machine, `%NAME%` expanded), or the login shell's on macOS and
  Linux (started without the inherited login variables). A login variable that is no longer saved is
  removed. Every other variable Hiveory was started with stays as it is.
- Login variables are a shared provider list (`PROVIDER_LOGIN_ENV`: `ANTHROPIC_*`, `OPENAI_*`,
  `GEMINI_*`, Bedrock, Vertex, OpenRouter, DeepSeek…) plus what each adapter declares
  (`CliAdapter.loginEnv`: Claude Code's `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_USE_BEDROCK`, Codex's
  `CODEX_HOME`, Copilot's `GH_TOKEN`, Aider's `AIDER_*`…). `NAME_*` matches a prefix. The union applies
  to every process, so a CLI typed into a plain terminal behaves the same.
- The saved environment is read at startup, whenever the window is focused, and after each start
  (`loginEnv`, applied in `sanitizeEnv`). A read that fails changes nothing.
- Variables Hiveory sets for a launch (hooks, MCP, auto-approve) still win over both.
- Remote hosts (SSH, Hiveory servers) are unchanged: their processes already use that machine's own
  environment.

## Consequences

A key exported only in the shell that launched Hiveory (`ANTHROPIC_API_KEY=… hiveory`) no longer
reaches agents; it belongs in the user's saved environment (Windows variables, or a shell rc file).
Agents already running keep the environment they started with until they are reopened. A new CLI
with its own login variables adds them to its adapter's `loginEnv`. `scripts/e2e-login-env.mjs`
starts Hiveory with stale variables and checks that a pane never sees them.
