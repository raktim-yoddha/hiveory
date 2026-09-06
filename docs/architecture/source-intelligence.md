# Source intelligence, tasks, and board

Repository and task-provider facts cross the renderer boundary only as bounded, typed projections. The Rust host owns filesystem roots, credentials, provider requests, local cache, and board persistence.

## Local repository facts

`hiveory-git-service` receives a workspace root already resolved by `hiveory-workspace-service`. It exposes repository identity, remotes, branches, upstream divergence, linked worktrees, recent commits, conflict state, working-tree status, and per-file diffs. The renderer cannot supply an arbitrary root or arbitrary Git arguments.

Git operations that change a workspace are host commands guarded by workspace trust, structured arguments, and the relevant orchestration or review policy. Managed worktrees and checkpoints remain owned by Code orchestration.

## GitHub collaboration

The desktop host invokes the installed and authenticated `gh` CLI through bounded argument vectors, timeouts, and response-size limits. Only parsed repository, issue, pull-request, and check fields enter renderer state. Raw credentials and command diagnostics are redacted.

The last successful hosted-source snapshot is cached in `hiveory_code_hosted_tracking_cache`. Refresh failures return an explicit missing-CLI, authentication, no-remote, offline, rate-limit, stale-cache, or provider-error state.

## Task providers

Task-source metadata is stored per workspace in `hiveory_task_sources`. Credentials are represented by opaque secret references and resolved only by the Rust host.

| Provider | Authentication | Transport | Current behavior |
| --- | --- | --- | --- |
| GitHub | authenticated local `gh` CLI | structured local process | issues, pull requests, projects/source context, refresh, and original URLs |
| Jira Cloud | site URL, account email, and API token | bounded HTTPS REST requests | connection test, issue query, search/filter, and original URLs |
| Linear | personal API key | bounded HTTPS GraphQL requests | connection test, issue query, search/filter, and original URLs |

A source becomes selectable only after its configuration passes validation and a bounded read-only connection test. Hiveory never inserts simulated accounts or tasks when a provider is unavailable.

## Workspace board

The board merges provider items with durable tasks from local Code runs. It stores Hiveory-specific organization separately from source data:

- Todo, In progress, In review, and Done lane placement;
- a compact one-line pinned strip that expands on request;
- search and provider filtering;
- links back to the provider item;
- local code-run task status and context.

Dragging a GitHub, Jira, or Linear item changes its local board lane. It does not change the provider's workflow state. A future provider mutation must use a separately declared tool, display the target account and action, and pass the normal approval policy.

## Trust and failure behavior

Local repository reads require the workspace Git capability. Provider calls use only the configured source and never inherit renderer network authority. Responses, timeouts, and errors are bounded; credentials and raw provider bodies are excluded from logs and SQLite. Cached data is labeled stale so the UI cannot present it as a successful live refresh.
