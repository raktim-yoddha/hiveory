# ADR 0007 — CLI Identity Icons

## Decision

CLI logos are data owned by each adapter (`IconReference`) and sent to the UI
through the registry; the UI never hardcodes providers.

- Claude Code, Gemini CLI, OpenCode: SVG paths from Simple Icons (CC0 data;
  marks remain their owners' trademarks, used only to identify the CLI).
- Codex: no openly licensed mark is bundled, so it uses the documented neutral
  fallback (monogram `>_`).
- Unknown CLIs render a `?` monogram.

## Consequences

Replacing a fallback with an official asset is a one-line adapter change.
