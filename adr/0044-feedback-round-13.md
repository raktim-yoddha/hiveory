# ADR 0044 — Feedback round 13: one look, attached lines, terminals that remember

Builds on ADR 0043. Decided by the product owner, 2026-10-12.

## Context

The product owner tried round 12. The Appearance section bar did not look like the app's other
section bars; chosen cards still showed a bright outline over a dull body; attached panes could not be
told apart; Kanban cards were faint on some themes; terminals showed a status dot nobody tracks; and
three of the six themes were placeholders. They also asked for Queen Bee to be put away in the title
bar, GitLab, Jira and Linear to work like GitHub, a closed and reopened Workspace to keep its memory,
a livelier app, and a full pass for speed, memory, security and the guide.

## Decision

### Look
- Settings › Appearance uses the same section bar as every Settings page (segmented, with icons):
  **Theme · Panes · Background · Terminal font**. Theme holds the built-in themes and, right under
  them, VS Code themes; there is no separate VS Code themes section.
- Three built-in themes: Dark, Bronze, Silver. Midnight, Jade and Rose are gone; a saved one falls
  back to Dark (`THEME_IDS`), and the phone follows.
- A chosen card (theme, pane style, pane spacing) is a brighter tinted fill (`--fill-chosen`) with the
  accent name, never an outline; hover is a fill too. The same goes for bot choices and routine days.
- Attached panes are split by a one-pixel line: the shell shows `--color-pane-line` through a
  one-pixel gutter, and under the title bar. Over a wallpaper the gutter shows the picture instead.
  In Tabs style the tabs then run square and full height from the pane's very corner; spaced panes
  inset the first tab as far from the side as from the top.
- Kanban cards: a raised fill that stands clear of the column in every theme, the name at full
  strength, the state in words in a tinted pill, a waiting card tinted, a running bar on a working
  card. A stopped agent stays readable; only its logo greys out.
- Terminals (CLIs of kind `shell`) have no status: no dot on the pane, its tab or the sidebar, no
  waiting tint; the sidebar calls them "Terminal".
- Settings › Skills, MCPs & Apps (renamed) has room at the top of every group.

### Queen Bee in the title bar
- Settings › Queen Bee › Bar & shortcut › Where she sits gains **Title bar only**, also in her menu
  ("Put away in the title bar"). Her bar is hidden; her mark sits after the side panel button with a
  dot for an unseen message. A click, her shortcut or a question drops her bar down under it; Escape
  or a click elsewhere puts it away. A browser page steps aside while she is down.

### Integrations like GitHub
- GitHub, GitLab, Jira and Linear share one path: reviews and issues in the Dashboard, issues in the
  create dialog, Start worktree from an issue. Two gaps are closed: the Workspace avatar comes from
  its code host, GitLab as well as GitHub (`CodeHost.avatarUrl`, "Code host avatar"); and the issue or
  review a worktree was started for shows on its card and is told to its agents (`hiveory_about`).

### Terminals keep their memory
- When Hiveory quits or a Workspace is removed, each terminal's last 64 KB of output is saved
  (`runtime/<agent>/scrollback.txt`) and its process ends, so nothing stays in memory. When the pane
  starts again the output is drawn first under "restored from last time". An agent that resumes its
  conversation redraws it itself, so its saved output is dropped. Closing a pane deletes it.

### Speed and memory
- The renderer is minified (electron-vite leaves it unminified by default): 3.8 MB became 2.1 MB.
- Settings, Bots, Chat and the code editor (CodeMirror) load when first opened (`React.lazy`), and
  Bots and Chat mount on their first visit, then stay mounted as before. A window that starts in Work
  parses about a third of the code it did. `SettingsPage`/`SettingRow` moved to their own module so a
  Workspace's settings don't pull the whole Settings window in.
- A terminal off screen for 90 seconds is freed in the window (its grid, scrollback and GPU context);
  main keeps its output, so showing it again rebuilds it from there. Before, every terminal ever shown
  stayed in memory until its agent was closed.

- While an agent works its model is read from the newest 64 KB of its session file (it read up to
  480 KB every five seconds); a Workspace's Worktrees tab stops polling Git while the window is hidden.

### The Guide
- Settings › Guide is rewritten: a short, current chapter for each part of the app (getting started,
  worktrees and Git, panes, arranging, the Kanban and side panel, the browser, Queen Bee, bots, chat,
  routines, skills and apps, integrations, remote and phone, keyboard, appearance, troubleshooting).
  It had stale facts (browsers in the side panel, agents never relaunching) and no word on half the app.

### Livelier
- Small CSS-only motion, shortened for reduced motion: a new pane springs into place, a new tab drops
  into its strip, side panel tabs fade up on every switch, a worktree's pane list unfolds row by row,
  a Kanban column's count pops when it changes, and a working card runs a bar along its edge.

### Found along the way
- A skill whose description is a YAML block (`description: >`) showed ">"; block values are read.
- An agent's new page in a worktree nobody was looking at dropped the agent's first address: the
  blank page it starts on committed last. Navigations now wait for that first blank load (agent
  browsing there went from a 15 s timeout to well under a second); the panes suite covers it.
- Queen Bee's shortcut (or menu) closes Settings first: Settings is a window over the app, and her
  bar under it could not take the keys. In the title bar, Escape inside her input puts her away once
  there is nothing left for it to close.
- The full end-to-end suite follows the app again (Workspace/Worktree names, the New worktree
  dialog, Settings as a window, replies behind her message button) and shares its harness with
  the panes suite.

## Consequences

The theme enum shrank: a theme only an older build knows reads as Dark. Saved terminal output lives
in each agent's runtime folder and is removed with the agent. Queen Bee's placement stays a
per-window preference (local storage), now with three values.
