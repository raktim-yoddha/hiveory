# ADR 0072 — Find in a terminal

Builds on ADR 0018, 0047 and 0061. Decided by the product owner, 2026-11-13.

## Context

A long agent or build run leaves thousands of lines in a terminal's scrollback, and the only way to
find an error or a path in it was to scroll. Orca, Paseo, VS Code and Windows Terminal all search a
terminal's scrollback; it was item 4 of the feature-gap research
(`docs/research-feature-gaps-2026-11.md`).

## Decision

- **Find in the terminal** is a keyboard shortcut in Settings › Keyboard (Panes and tabs): ⌘F on macOS,
  Ctrl+Shift+F on Windows and Linux, where Ctrl+F stays the shell's own key (forward one character),
  as in Windows Terminal. It is also in Find (Ctrl+Shift+P). It applies to the terminal being typed in
  (an agent's terminal or a plain one); with the focus elsewhere its keys go on, so ⌘F still finds in
  an editor pane.
- It opens a bar over the terminal's top right: the search text (the terminal's selection, when there
  is one), the count ("3 of 12", "No results"), Match case, Regular expression, previous and next, and
  close. Typing searches as you go; Enter goes to the next match, Shift+Enter to the previous one,
  Escape closes it and returns to the terminal. Every match is highlighted, the current one more
  strongly, and marked on the scrollbar, in colors taken from the terminal theme.
- Mechanics: `@xterm/addon-search` 0.16 (the release matching `@xterm/xterm` 6.0), one per terminal in
  the renderer's terminal registry. It searches what the terminal holds (its 10,000 lines of
  scrollback). No IPC, no stored data.

## Consequences

- A new dependency (`@xterm/addon-search`), kept on the same release line as xterm.
- Search covers the scrollback this window holds, not output older than it; a TUI that redraws in place
  (an agent's full-screen view) shows only what is on its screen and in the scrollback it left.
- The phone's terminal has no find yet.
