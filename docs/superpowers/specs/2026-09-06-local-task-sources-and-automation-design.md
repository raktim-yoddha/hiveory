# Local task sources and automation rebuild

## Goal

Turn the Tasks and Automations surfaces into real local desktop features modelled on the Orca reference flows. Hiveory must never show simulated accounts, connected providers, tasks, or automation engines.

## Local task sources

Each workspace can select any combination of GitHub, Jira, and Linear sources. Source metadata and selected scopes are stored in Hiveory SQLite; credentials live only in the operating-system keyring.

- GitHub uses the already-authenticated `gh` CLI and the existing hosted-source cache.
- Jira uses the Jira Cloud REST API with a user-provided HTTPS site URL, email, and API token.
- Linear uses the Linear GraphQL API with a user-provided API key.
- A connection test makes a bounded read-only request before a source becomes available.
- The Tasks page has a source switcher, source-specific filters, a search field, refresh, and a data table. Unconfigured sources render a connection action, not rows or fake state.

## Automations

The existing local scheduler remains the execution authority. The renderer becomes a compact desktop automation list with search, filters, template selection, and a modal editor patterned after Orca:

- prompt editor on the left;
- local Agent, workspace, session, schedule, grace period, folder/plugin grants, and bounded-run settings on the right;
- real template application, validation, save, pause/archive, and run-now actions;
- no Hermes or remote-host target, because Hiveory is local-only.

## Pane summary

The workspace rail displays up to six pane icons and the total pane count. It no longer spends width on a `+N` counter.

## Validation

Unit-test provider response parsing and source validation. Verify native source commands and renderer interactions, then run formatter, lint/typecheck/tests, Rust checks/tests, and the production package build.
