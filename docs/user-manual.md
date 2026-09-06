# Hiveory local feature user manual

This guide explains how to use and test the local Plugins, Skills, Automations, Tasks, and Workspace board features in the Hiveory portable app. It is written for a normal desktop workspace with no Hiveory cloud service.

## Before testing

1. Launch the portable application and open or create a trusted workspace.
2. Keep Hiveory in the foreground while you use its sidebar. The global surfaces replace the workspace canvas; they do not open a browser page.
3. Create at least one Hiveory Agent before testing Skills or Automations. The application cannot assign a skill or schedule work without an agent.
4. Do not enter a real provider token merely to explore a form. Connections are intended for user-owned credentials and are stored in the operating-system keyring after a successful save.

The left workspace rail contains **Automations**, **Plugins**, and **Skills**. The title-bar Tasks button opens Tasks. The Workspace board button is in the lower-left workspace tools area.

## Plugins

Plugins are local, declarative HTTPS adapters. They are not downloaded executable extensions. A plugin can only call the host and tools declared by its manifest.

### Use an existing plugin

1. Select **Plugins** in the workspace rail.
2. Use **Search plugins** to find a provider.
3. Read the provider row before enabling it. The row shows its description, current connection status, enable switch, and the three-dot menu.
4. Turn the switch on to make the manifest available on this device. Turn it off to remove it from the active catalog. This does not delete an existing connection.
5. Select the three dots, then choose **Configure**. The dialog shows the adapter, declared HTTPS allow-list, permissions, tools, and connection records.

### Connect and test a provider

1. Enable the provider.
2. Open its three-dot menu and choose **Add connection**, or choose **Configure** and then **Add connection**.
3. Enter a clear connection label and the provider credential requested by the dialog. Use a provider-issued test token when possible.
4. Save the connection. Hiveory stores the credential through the OS keyring and does not display it later.
5. In the provider configuration dialog, select **Test** for the new connection.
6. Confirm the connection receives a validation time and no error message.
7. Select an Agent and grant only the tools that Agent needs. A connection alone does not grant an Agent access.
8. Use **Dry run** only with a safe, documented provider path and arguments. Check the displayed output before granting any write-capable tool.

### Create or import a custom plugin

Select **Add custom** to create a local JSON HTTP plugin. Supply a lowercase identifier, name, description, one HTTPS host, tool name, and either read-only GET or approved POST. The host is an allow-list boundary, not a suggestion: use only the provider API hostname, without a URL path.

Select **Import** to choose an existing plugin manifest. Hiveory validates the manifest before registering it. A rejected import is expected for malformed identifiers, unsupported hosts, or invalid tool definitions.

### Plugin test checklist

| Check | Expected result |
| --- | --- |
| Search | The visible list narrows without losing the catalog state. |
| Enable / disable | The switch changes state and the row remains usable. |
| Three-dot menu | Configure, connection, and enable/disable actions are available. |
| Connection test | A valid provider connection reports success and a validation time. |
| Agent grant | Only selected, tested tools are available to that Agent. |
| Dry run | The response is shown; no unreviewed write action is performed. |

## Skills

Skills are validated local `SKILL.md` instruction packages. They are shared with Hiveory-launched coding CLI sessions only after they are loaded for the selected Agent.

### Assign a built-in skill

1. Select **Skills** in the workspace rail.
2. Choose the target agent in **Agent assignment**.
3. Read the skill name, description, and origin. **Built in** skills are shipped locally; **Custom** skills are local packages.
4. Select **Load** on one skill.
5. Confirm the control changes to **Loaded** and the assigned count increases.
6. Launch a new Hiveory CLI session for that Agent and use a request matching the skill's purpose.
7. Return to Skills and select **Loaded** again to unload it. Confirm the assigned count returns to its prior value.

Do not use a running terminal from before the assignment as proof that a newly loaded skill was supplied to it. Start a Hiveory-managed CLI session after changing the assignment.

### Create a local skill

1. Select **Create skill**.
2. Enter a lowercase identifier using letters, digits, and dashes, for example `release-check`.
3. Add a name and a concise description.
4. Add optional comma-separated trigger phrases.
5. Write the instructions the Agent should follow. These instructions become the body of the generated `SKILL.md`.
6. Select **Create skill**. The skill must appear in the list as **Custom**.
7. Assign it with **Load**, then start a new Hiveory-managed CLI session and verify the instructions are relevant to the requested task.

### Import a skill package

1. Select **Import SKILL.md**.
2. Choose a local `SKILL.md` package.
3. Confirm the imported skill appears in the list or read the validation error.
4. Load it for an agent only after reviewing its instructions and declared permissions.

### Skills test checklist

| Check | Expected result |
| --- | --- |
| Agent selector | Changing the Agent refreshes assignments for that Agent. |
| Load / unload | State and assigned count change, then can be restored. |
| Create | A valid local skill appears as Custom. |
| Import | Valid `SKILL.md` appears; malformed packages report an error. |
| New CLI session | The selected Agent's loaded skills are available to sessions launched afterward. |

## Automations

Automations are durable local schedules. They run while Hiveory and its local scheduler are available; they do not need a Hiveory server.

### Inspect existing automations

1. Select **Automations** in the workspace rail.
2. Search by name, description, agent, schedule, or timezone.
3. Select an automation row to open its details.
4. Verify the schedule, next run, catch-up policy, concurrency policy, delivery setting, limits, prompt snapshot, and recent executions.
5. Select **Edit** to review fields, then select **Cancel** if you are only testing the form.
6. Use **Show archived** to confirm archived schedules remain inspectable.

### Create a schedule from a template

1. On Automations, choose a template such as **Weekday repo audit** or select **New automation**.
2. Select the Agent that should run the work.
3. Review the prompt and describe the desired outcome in the description.
4. Enter a five-field cron expression and an IANA timezone, for example `0 9 * * 1-5` and `Asia/Kolkata`.
5. Choose a catch-up policy:
   - **Skip missed**: no recovery run after downtime.
   - **Run latest**: run only the newest missed occurrence.
   - **Run all, bounded**: recover missed occurrences within the scheduler limit.
6. Choose a concurrency policy:
   - **Skip if active**: do not overlap work.
   - **Queue one**: preserve one pending occurrence.
   - **Parallel, max 4**: permit bounded overlap.
7. Keep delivery as **In-app only** for a quiet test. Choose native delivery only if you want desktop notifications.
8. Set conservative limits for tool calls, duration, and approval timeout.
9. Select workspace folders and plugin tools only when the selected Agent already has those grants. A plugin tool appears only after its plugin is enabled, connected, tested, and granted to that Agent.
10. Leave **Enable schedule immediately** off when validating a form without scheduling work. Select **Save automation** only when you intend to persist it.

### Test an automation safely

For a non-destructive UI test, open a template or a new-automation form, confirm that missing required fields disable **Save automation**, complete the fields, and then select **Cancel**. This tests validation without persisting a schedule.

For an execution test, use a small, read-only prompt and a dedicated test Agent. Save the automation, open its detail panel, and select **Run now**. Confirm that a manual execution appears in **Recent executions**. After recording the result, use **Archive routine** to stop future scheduled occurrences while retaining the evidence.

### Automation test checklist

| Check | Expected result |
| --- | --- |
| Search and archived filter | List changes without losing routine data. |
| Template | Opens a populated form with an editable prompt and schedule. |
| Form validation | Save remains disabled until name, agent, prompt, cron, and timezone are present. |
| Plugin-tool picker | Shows only enabled, tested, granted plugin tools. |
| Save | Detail panel shows a durable next occurrence. |
| Run now | A manual execution appears with a state and report or error. |
| Archive | Schedule stops being active but remains available through Show archived. |

## Tasks

Tasks collect items for the selected local workspace. GitHub uses the authenticated local `gh` CLI. Jira uses a site URL, account email, and API token. Linear uses a personal API key. Jira and Linear secrets are stored in the OS keyring.

### Configure task sources

1. Select the **Tasks** button in the application title bar.
2. Select the workspace to inspect.
3. Read the GitHub, Jira, and Linear source cards.
4. For GitHub, authenticate the local `gh` CLI outside of Hiveory, then refresh Tasks. The card should report **Local CLI** or a connected state.
5. For Jira or Linear, select the plus button on the relevant source card.
6. Enter the requested endpoint and user-owned credentials, then choose **Test and connect**.
7. Confirm the source card changes to **Connected**.

### Use Tasks

1. Use the provider tabs to show **All**, **GitHub**, **Jira**, or **Linear**.
2. Search by identifier, title, status, assignee, or project.
3. Select a task row with an external-link icon to open its original provider URL.
4. Use Refresh after changing a source outside Hiveory.
5. Use the remove button only when you intend to remove the local source connection.

### Tasks test checklist

| Check | Expected result |
| --- | --- |
| Workspace selector | Sources and rows change with the selected workspace. |
| Source test | Valid Jira or Linear credentials change the card to Connected. |
| Provider tab | Restricts the table to the selected provider. |
| Search | Narrows rows by visible task metadata. |
| External row | Opens the original provider task; it does not edit the provider. |
| Empty state | Explains whether a source needs connection, authentication, or a changed search. |

## Workspace board (Kanban)

The Workspace board is Hiveory's local Kanban view. It combines local Hiveory code-run tasks with items from connected task sources for the active workspace. It has Todo, In progress, In review, and Done lanes.

Moving a provider item between board lanes changes Hiveory's local board preference only. It does not update GitHub, Jira, or Linear.

### Use the board

1. Open **Workspace board** from the lower-left workspace tools area.
2. Select Refresh to load current local code-run tasks and connected provider tasks.
3. Use Search tasks to narrow cards by task identifier, title, or context.
4. Drag a card to a lane. Confirm its new position remains after Refresh.
5. Select a card to open its workspace or provider URL. Double-clicking a card does the same.
6. Select the pin icon to add a card to **Pinned**.
7. Select the Pinned line to expand its cards. Select it again to collapse back to one line.
8. Move a test card back to its original lane and remove its pin when finished.

### Board test checklist

| Check | Expected result |
| --- | --- |
| Refresh | Current local and connected-source tasks load. |
| Lanes | Todo, In progress, In review, and Done display counts and cards. |
| Drag | Card status persists locally after refresh. |
| Pin | Pinned strip stays compact until expanded. |
| Open card | Local tasks open their workspace; provider tasks open their source URL. |
| Empty board | Explains that a local code run or GitHub, Jira, or Linear source is needed. |

## Troubleshooting and evidence to collect

If a global surface does not open from the workspace rail, record the active mode, workspace name, the exact button pressed, and a screenshot before restarting Hiveory. The expected behavior is that Plugins, Skills, and Automations replace the Code workspace canvas.

For a failed connection, record the provider name and visible error message, but never copy tokens, API keys, raw request headers, or browser cookies into a bug report.

For a failed automation, open its detail panel and record the execution state, scheduled time, and visible error. For a failed task source, record the source status and whether the workspace's `gh` CLI is authenticated. For a board persistence issue, record the card title, starting lane, destination lane, and result after Refresh.
