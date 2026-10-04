# ADR 0007 — CLI Identity Icons

## Decision

CLI logos are data owned by each adapter (`IconReference`) and sent to the UI
through the registry; the UI never hardcodes providers.

- Superseded in part by ADR 0012: every CLI now ships its official mark, from
  LobeHub Icons (MIT) or the publisher's GitHub organization avatar, generated
  into `src/main/services/cli/adapters/icon-data.ts` by
  `scripts/generate-cli-icons.mjs`. Marks remain their owners' trademarks and
  are used only to identify each CLI.
- Unknown CLIs render a neutral monogram.

## Consequences

Replacing a fallback with an official asset is a one-line adapter change.
