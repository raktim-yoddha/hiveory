# ADR 0054 — Hiveory Pet sees this computer's agents

Builds on ADR 0006 (CLI hooks) and ADR 0049 (the Needs you status). Decided by the product owner, 2026-10-22.

## Context

The product owner wants a desktop pet: a small bot at the top of the screen (or floating anywhere)
that shows every agent session on the computer, in Hiveory and outside it (Claude Code, Codex,
Gemini CLI, Cursor, Copilot CLI in any terminal or editor), and peeks out when one finishes or
needs the user. It must be useful without Hiveory, so it is not a Hiveory feature but its own app,
**Hiveory Pet** (Windows, native C#/WPF, its own repository `hiveory-pet`). Hiveory only needs a
way to tell the pet about its agents, and a place to say the pet exists.

## Decision

- **The pet link.** While Hiveory runs as a desktop (not `--serve`) and Settings › Agents ›
  **Let Hiveory Pet see your agents** is on (the default), Hiveory listens on `127.0.0.1` on a
  random port and writes `{port, token, version}` to `pet-link.json` in its Runtime folder
  (`%LOCALAPPDATA%\Hiveory\Runtime` on Windows), readable by this user only. Reading that file
  is the pairing: the pet's Connect Hiveory is one click and no code. The file is removed when
  the link stops or Hiveory quits. Settings key `petLink`, default true.
- **One read-only stream.** `GET /pet/events` with `Authorization: Bearer <token>` is a
  Server-Sent Events stream. Each frame is `{"agents": [{id, name, cli, workspace, worktree,
  status}]}` with every agent that runs or is not Idle (terminals are left out); `status` is the
  board's `idle | working | waiting-for-you`. A frame is sent on connect and after every
  `runtime.changed` or `state.changed`, settled for 150 ms. Nothing else is served; the pet can
  never change anything in Hiveory.
- **What it never carries.** No paths, terminal text, activity text, prompts, files or keys:
  only names and statuses, as rule 27 allows. The pet gets what an agent is doing from that
  agent's own hooks, which it installs itself when the user asks.
- **One row per agent.** Hiveory already starts every agent with `HIVEORY_INSTANCE_ID`; the pet's
  hook relay passes it on, so a session seen through hooks and the same Hiveory agent are shown
  once, with the Hiveory pet name, Workspace and Worktree.
- **Where users find it.** Settings › Agents has a Hiveory Pet group: what it is, a Download
  button (the `hiveory-pet` GitHub releases) and the toggle above. APP_GUIDE says so.

## Consequences

- Any program this user runs can read `pet-link.json` and see agent names and statuses. That is
  the same trust as the hook endpoint (ADR 0006); turning the toggle off closes it.
- The pet follows only this computer's Hiveory; a Hiveory used from another device (ADR 0022)
  is not shown. The pet answers no permissions in v1: it shows who needs you, and clicking a row
  brings that window forward.
- macOS and Linux pets, and approving from the pet, are left for later.

## Amendment (2026-10-22): the CLI id travels too

Each agent in a frame also carries `cliId`, the CLI's catalog id (`claude`, `codex`, `gemini`…), so the pet shows
the same official mark Hiveory does instead of guessing from the display name. It is an identifier from Hiveory's
own catalog, not user data, so rule 27 still holds. The pet copies the marks from `icon-data.ts` with its
`scripts/import-icons.mjs`.
