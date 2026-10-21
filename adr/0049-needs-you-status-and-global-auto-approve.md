# ADR 0049 — Needs you: calmer status, reliable detection, and auto-approve for every agent

Builds on ADR 0002 (the three statuses), ADR 0006 (status detection) and ADR 0043 (pane spacing).
Decided by the product owner, 2026-10-21.

## Context

Feedback from the product owner:

- The status colors (bright mint green, bright amber, glowing and pulsing dots) looked generic and
  loud next to the warm graphite surfaces.
- Status was wrong after the first permission prompt. Allowing a prompt could turn a working agent
  amber again, and an agent could stay "Waiting for you" after it had resumed. Causes:
  - Claude Code's `Notification` hook for a permission prompt can arrive after the user has
    answered (each hook is its own `curl` process), flagging the now-working agent.
  - The PTY fallback only left the waiting state on Enter. A prompt answered with a choice key
    (`1`, `y`, Esc) or from the phone stayed waiting forever.
  - It matched prompts in raw output, so the last frames a TUI draws while removing an answered
    prompt, or a prompt quoted in the conversation, counted as a new one.
- The Auto-approve setting only pre-filled the new-worktree and preset dialogs. Every Primary
  worktree, and worktrees found on disk, start with it off, and an agent kept the value it was
  created with, so turning the setting on did nothing for most agents. OpenCode versions without
  `--auto` ignored the flag silently.
- Settings › Appearance › Panes compared Hiveory with another product by name.

## Decision

**"Needs you".** The third status reads "Needs you" everywhere users see it: the status dot,
the Kanban column and pill, reasons ("Needs your permission", "Needs your answer", "Needs you to
confirm", "Needs your plan approval"), Queen Bee's reports, notices and the guide. The code keeps
`waiting-for-you` (ADR 0002; the phone shares it).

**Calmer colors.** Taupe idle, sage working (`#9fb08a`), ochre needs you (`#d29b5b`), no glow
(`--glow-*` are `none`). Only Needs you moves, as a slow faint ring; the working bar on a Kanban
card is fainter and slower; a needing card is tinted half as much; a pane needing you gets an ochre
edge without a halo. The phone's palette is generated from the same tokens.

**Detection.**
- Claude Code: a permission prompt comes only from `PermissionRequest`; `Notification` counts only
  for MCP elicitation dialogs.
- `HeuristicDetector` finds a prompt in fresh output, then confirms it against the rendered screen
  (`PtySession.visibleText`) on the next tick. A prompt it found ends when it leaves the screen.
- Any waiting ends when the user answers: Enter, Esc or Ctrl+C, and for a permission or
  confirmation also a single choice key (a digit, y, n). Typing into a question does not answer it.
- For 1.5 s after an answer, output never counts as a new prompt.
- Waiting reported by a hook is left to hooks and the user, never ended by the screen check.

**Auto-approve for every agent.** While Settings › Agents › Auto-approve permissions is on, every
agent starts with permissions skipped, in every Workspace and Worktree, the Primary included,
whatever its Worktree or preset chose (`AgentService.withAutoApprove`, applied at each launch). An
agent in chat view gets full access too. While it is off, the Worktree's or preset's choice applies.
OpenCode and Kilo also get `OPENCODE_PERMISSION` / `KILO_PERMISSION` allowing every tool, so
versions without `--auto` skip permissions as well.

**No other product named.** The pane style cards and the guide describe Tabs and Attached in
Hiveory's own words; source comments name no other product.

## Consequences

- Turning the setting on affects agents as they start or restart; running agents keep their
  process until restarted.
- With the setting on, a Worktree's own "auto-approve off" has no effect; turning the setting off
  restores it.
- A prompt confirmed by the screen shows up to one tick (1 s) later than before.
- A question with several parts answered with Enter for each part reads as working after the first
  Enter; silence then makes it idle. Hooks report no event for those steps.
