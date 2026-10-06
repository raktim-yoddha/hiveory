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

## Panes follow a moving sidebar in the same frame
**Context.** Panes are absolutely positioned. Their px rects were computed in
JavaScript from a `ResizeObserver` measurement of the layout container. When a
sidebar or the side panel moved, the CSS grid moved the column at once, but the
measurement, and so the pane rects, arrived a frame later.

Measured per animation frame while dragging the sidebar, every pane's x reversed
direction 157 times, from stale px then the catch-up. That was the jitter. A first
attempt that only turned off the slots' easing did not change it.

**Decision.**
- Panes and dividers are placed in shares of the container plus fixed px:
  `calc(share% + px)`, from `relativeGeometry()`.
- Every edge is linear in the container's size, so two geometry passes give it
  exactly. A unit test checks it matches the px layout at any size.
- The browser now lays panes out in the same frame as the container. The same drag
  measures 2 reversals, which are the drag path's own turns.
- Container resizes no longer change the slots' style values, so they never
  animate. Split, swap and close still do.
- Pixel geometry stays for drag targets and limits only.
- Terminals still refit once after a resize burst. Refitting while dragging would
  make every CLI redraw its whole screen many times a second.

## Queen Bee floating: one size, one place
**Decision.** The floating bar is fixed to the bottom centre of the window at
`--queen-bar-width`. It doesn't shrink with the main area, and it doesn't move with
it when sidebars or the side panel change. Only a window narrower than the bar caps
its width. The docked bar still follows the main area.

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
