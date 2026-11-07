# ADR 0057 — Queen Bee removed

Supersedes ADR 0019 (Queen Bee), and with it the parts of ADR 0024, 0038, 0041, 0044, 0047, 0048 and
0056 that belong to her. Changes rule 27 of the engineering contract.
Decided by the product owner, 2026-11-07.

## Context

The product owner has a different plan for Queen Bee and wants the current one gone completely until
then: her bar and card, personalities, notes, model providers, voice (speech packs, push-to-talk,
talkback), her shortcut and its system-wide hook, and her live updates.

## Decision

- **Queen Bee is gone.** No bar (docked, floating or put away in the sidebar), no Settings › Queen
  Bee, no Queen Bee row in Settings › Keyboard, no guide chapter. Her IPC channels (`queen.*`,
  `voice.*`) and events (`queen.update`, `queen.hotkey`, `voice.changed`) are removed, from
  `REMOTE_CHANNELS` and `CLIENT_LOCAL_CHANNELS` too. The phone never used them.
- **Saved data:** her settings (`queen*`) and provider accounts with their sealed keys (`queenBrains`)
  are dropped quietly when the state loads. The speech packs folder (`Voice` under the machine's data
  folder) is left on disk.
- **Dependencies:** `sherpa-onnx-node` (speech) and `uiohook-napi` (the system-wide hook) are removed,
  with their `asarUnpack` lines. The window grants no device permission any more, and the macOS
  build drops the microphone entitlement and usage text.
- **What stays, under neutral names:**
  - `AgentWatcher` (was `QueenWatcher`) still watches real status changes; a Workspace's "Announce
    agents" switch still silences it. It now feeds only the phone's "An agent needs you" push.
  - `agents.peek` (was `queen.peek`): one agent's status and last words on screen. Browser notes
    wait for it before sending.
  - The shortcut parser and labels move to `src/shared/keys/shortcut.ts` for Settings › Keyboard.
- **Rule 27** now speaks of any model call Hiveory makes itself, not Queen Bee; release notes name
  Schedules instead of Queen Bee as an example of app words.

## Consequences

- A user's Queen Bee settings, notes and provider keys are lost in the app. An older version keeps
  them only if its state file was not saved since.
- The packaged app is smaller and installs without the speech and keyboard-hook native modules.
- A new Queen Bee is a new ADR. It can reuse `AgentWatcher`, `agents.peek` and the shortcut parser.
