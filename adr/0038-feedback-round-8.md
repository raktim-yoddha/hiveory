# ADR 0038 — Feedback round 8: polish after 0.22

Builds on ADR 0019 (Queen Bee), ADR 0033 (Workspaces and Worktrees) and ADR 0037. Decided by the
product owner, 2026-10-11.

## Context

The app is feature-complete for now; this round polishes it and fixes what got in the way. Every
change here ships as a PATCH release (the product owner's call for this polish phase).

## Decision

### Queen Bee's card stays closed until asked for
Live updates (an agent finished, needs you, stopped) no longer pop the card over the work. They
wait behind a message button on her bar, which shows a dot while something is unseen; the button
opens the card and pressing it again closes it. A reply to a command you just gave, a question
and a yes/no still open the card, since you are waiting for them. Closing (the button, Esc, ×, or
a reply timing out) keeps the last message, so the button can show it again.

## Consequences

- Updates are easier to miss: the dot and the optional spoken update are the only signals.
