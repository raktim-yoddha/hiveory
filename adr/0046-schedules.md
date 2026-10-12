# ADR 0046 — Routines are called Schedules

Builds on ADR 0028, 0030 and 0040. Decided by the product owner, 2026-10-12.

## Context

Work that runs on its own at set times was called a "routine" everywhere users look: the side panel
tab, the Bots page, the editor, the guide, Queen Bee and what bots are told. The product owner wants
the plainer word "Schedule". Separately, Chat's "Schedule a chat" switched the app to Bots mode to
show the editor, although ADR 0030 says the editor opens where it was asked for.

## Decision

- Users see **Schedule** (plural Schedules) wherever they saw Routine: the side panel's Schedules
  tab, Bots › Schedules, a bot's Schedules tab, "New schedule", "Edit schedule", "Delete schedule",
  the run log, notices, the guide and the app guide Queen Bee reads.
- Text bots and models read says schedule too (tool descriptions, run instructions, "your Schedules
  tab"). The bot tool names `schedule_routine` and `list_routines` stay, so saved prompts keep working.
- Queen Bee understands both words: "open schedules", "pause the Morning brief schedule"; "routines"
  still works. When she asks which one, she offers "the schedule" or "the trigger".
- Code keeps the name `Routine` (types, services, IPC channels, stored data), like `Project` for
  Workspace (ADR 0033). AGENTS.md's Vocabulary lists it.
- "Schedule a chat" in Chat opens the editor in Chat; Chat never jumps to Bots (as ADR 0030 intended).

## Consequences

No stored data or channel changes. Earlier ADRs keep the word "routine". Chat has no list of its
scheduled chats; they stay on the Bots Schedules page.
