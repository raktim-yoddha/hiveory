# ADR 0053 — The phone matches the desktop in every mode

Builds on ADR 0027 (the phone app), ADR 0039 (its five tabs) and ADR 0052; widens ADR 0027's phone scope.
Decided by the product owner, 2026-10-22.

## Context

ADR 0027 gave the phone "everyday control" only: it could watch and steer agents, chats and bot
threads, but not delete, edit bots or Schedules, browse files or attach anything. After ADR 0052 the
phone reached its computer over Tailscale and Wi-Fi, yet still had about a third of what a paired
desktop has. The product owner asked for the phone to match the desktop: files, editing bots and
Schedules, chat attachments and more notifications.

## Decision

`MOBILE_CHANNELS` (still a subset of `REMOTE_CHANNELS`, still default deny) adds:

- **Work:** `projects.add`, `projects.remove`, `workspaces.delete`, `workspaces.repair`, `git.init`,
  `agents.rename`, `presets.save`, `presets.delete`, `files.list`, `files.search`, `files.read`,
  `files.write`, `files.create`, `files.rename`, `files.delete`, `github.issues`.
- **Bots:** `bots.create`, `bots.update`, `bots.delete`, `teams.*`, `triggers.status`,
  `triggers.list`, `triggers.update`, `triggers.delete`, `triggers.enableLink`,
  `triggers.disableLink`, `routines.create`, `routines.update`, `routines.delete`, `routines.runs`.
- **Chat:** `chat.update`, `chat.delete`, `chat.attach`, `chat.queue`, `chat.unqueue`, `prompts.*`.

What the phone shows:

- **Work tab:** + adds a Workspace (a folder path on the computer, or a repository cloned into one);
  its settings set up Git and remove it from Hiveory (the folder stays). A worktree opens **Files**
  (browse, find by name, read and edit text, new file or folder, rename, delete), repairs a missing
  folder, saves its agents as a preset and deletes an isolated worktree. An agent can be renamed;
  presets can be deleted from Open an agent. Pull requests also lists open issues.
- **Bots tab:** + makes a bot; a bot's screen edits it (name, what it is for, brief, CLI, team, full
  access, schedules, talking to other bots, notifications, when it asks before acting) and deletes
  it. **Schedules** makes, edits (once, every N minutes, daily, weekdays, weekly, in the phone's time
  zone), runs and deletes Schedules and lists recent runs. **Triggers** turns the event link on and
  off and turns each trigger on or off, renames it, changes what its bot does, or deletes it.
  **Teams** makes, renames and deletes teams.
- **Chat:** a file from the phone goes with a message (`chat.attach`, then `chat.send`); a message
  typed while it answers waits its turn and can be taken back; saved prompts fill the box and the
  typed text can be saved; a chat can be renamed and deleted.
- **Notifications:** besides "An agent needs you.", a phone hears "A bot needs your yes." and "A
  schedule finished." / "A schedule needs a look." (`Sharing.notifyPhones`), with ids only, as before;
  a tap opens the bot or the run's thread.

Mechanics: the phone adds `expo-document-picker` and `expo-file-system` (picking and reading a file).
The Schedule wording and repeat rules move to `src/shared/domain/routine-text.ts` (dependency-free),
used by the desktop and the phone; `routine-schedule.ts` re-exports them.

## Consequences

- A lost or stolen paired phone can now delete and change things; removing it under Share this
  computer cuts it off at once, as before.
- Still on the computer only: app settings, accounts and keys; anything that needs its own screen
  (folder pickers, pane layout, the built-in browser, voice, updates); making a trigger (it picks an
  app account and that app's settings); a bot's own computer, memory and default model; Schedules
  with monthly or custom cron rules can be run, renamed and switched on or off from the phone but
  their timing is changed on the computer; Work-agent and new-chat Schedules are made there.
- Files open as plain text, up to about 300,000 characters on a phone.
