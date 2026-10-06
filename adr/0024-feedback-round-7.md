# ADR 0024 — Feedback round 7

Builds on ADR 0019 (Queen Bee), ADR 0023 (Apps) and the pane layout in
architecture.md.

## Apps: every account is named first
**Decision.** Connect and Add account both ask for the account's name before
anything opens. The name is required and unique per app. It is sent to Composio as
the account's alias, and it is how the user and agents tell several accounts apart.

## Apps: a real mark for every app
**Decision.** Every app and Composio itself shows its official mark. The marks come
from the CC0 svg-logos set, or, for apps it lacks, the mark Composio serves for that
toolkit. A test fails if any app has no mark, so the old initial fallback is gone.
`AppMark` draws an app's mark; `AppLogo` stays Hiveory's own logo.

## "Plugins" is "Apps"
**Decision.** The feature is called Apps everywhere: Settings › Skills, MCP & Apps,
`apps.*` IPC, `AppService`, `AppsPanel`, `provider` on the stored connection. Older
state files say `pluginId`, which is read as `provider`. Codex's own `plugins.*`
flags and the historical ADRs keep their words.

## Sidebar order follows work, not clicks
**Context.** The "Recent" sort used `lastOpenedAt`, which every click on a project
moved, so projects jumped to the top just from being looked at.

**Decision.**
- `Project.lastActiveAt` moves when there is real work in a project:
  - an agent starts a turn (its status becomes working);
  - an agent opens;
  - a workspace is created.
- It moves at most every 30 s, and the sort falls back to `createdAt`.
- The sort is labelled "Recent activity". Opening a project still records
  `lastOpenedAt`, but that no longer reorders anything.

## Panes follow a moving sidebar exactly
**Context.** Pane slots ease `left/top/width/height` so that splits, swaps and
closes animate. A sidebar sliding or being dragged resizes the layout container on
every frame, which restarted that easing toward a new target each frame. Panes
lagged behind and wobbled, most visibly the rightmost one.

**Decision.**
- While the container is resizing, slots take no position transition (the
  `following` state). This is the same rule already used while a divider or pane is
  dragged.
- Easing returns 180 ms after the last size change, so layout operations still
  animate.
- Terminals still refit once after a burst.

## Queen Bee reaches the rest of the app
**Decision.** New actions in the closed set:
- `set-setting`: agent tools, browser use, computer use, auto-approve, chat view;
- `open-url`: the side browser, http(s) only;
- `open-file`: search, then open in an editor pane;
- `arrange`: equal or columns;
- `git-status`, `pull-requests`, `apps-report`, `check-updates`;
- `save-preset`: the workspace's CLIs and counts;
- `new-chat`: with a CLI and a first message;
- `message-bot`: a new thread;
- `resume-session`: the CLI's latest conversation here;
- `add-project`;
- "restart all": several `restart-agent` actions.

The rule parser handles them in `app-commands.ts`. Each one runs on an existing
IPC call. The model tier gets the same actions with id checks.

Before it acts on its own reading, the model asks: a setting change, a bot message
or chat text that isn't the user's exact words. Bots join the context it is shown.

## More CLIs
**Context.** A market check found 35 providers in Emdash and CLI lists in
OpenMausBot, Superset and Vibe Kanban. They run CLIs Hiveory did not.

**Decision.** Hiveory adds Hermes Agent, Devin CLI, Jules, Rovo Dev
(`acli rovodev run`), Codebuff, CodeBuddy Code, Qoder CLI, Pi, Command Code,
MiMo Code and Trae Agent (`trae-cli interactive`).
- Commands are as their makers document them.
- Their marks come from LobeHub Icons, or the publisher's GitHub organization.
- No auto-approve or resume flag is assumed, so those options stay off until a
  flag is verified.
- Left out: Zero (a generic executable name), and niche forks of listed CLIs.
