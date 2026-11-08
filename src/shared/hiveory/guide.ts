/**
 * What Hiveory is and where everything lives, in the user's words (ADR 0041). One source for every
 * agent's `hiveory_about` tool, so agents answer "where do I…" questions the same way.
 * Product facts only: never user data, paths or settings values.
 */
export const APP_GUIDE: ReadonlyArray<readonly [place: string, what: string]> = [
  ['Hiveory', 'A desktop app that runs coding-agent CLIs (Claude Code, Codex, Gemini, OpenCode and more) side by side. The sidebar (left, with its hide button at its top and Settings at its bottom; hidden, a slim rail of every workspace icon: click to open its last worktree, double-click to list its worktrees by initials), the open worktree and its side panel (right, shown or hidden by the button at the top right) all start at the top of the window. A phone app pairs with it.'],
  ['Workspace', 'A folder or Git repository in the sidebar. Its mark folds its worktrees; right-click for its settings.'],
  ['Worktree', 'The Primary (the workspace folder itself) or an isolated branch folder made by "+" (new, existing or remote branch). Each holds agent and terminal panes.'],
  ['Agents', 'Each pane runs one CLI instance with a pet name. Its status is Idle, Working or Needs you (terminals have none); the sidebar bar under a worktree lists every pane. Panes split right or bottom and can be dragged. In chat view the message box picks the CLI and model in one control (switching CLI hands the conversation over), effort, permissions, fast and plan mode; @ tags files, / lists the CLI commands and skills; above it are the agent tasks, its subagents and the worktree changes; each reply that changed files can be viewed or undone. Agents can open subagents on any installed CLI and model. After a quit, a reboot or a restored workspace, agents resume their conversations and terminals show their last output.'],
  ['Panes', 'A pane holds an agent, a terminal, a file or a browser page (the built-in browser agents drive; open one from a pane\'s "+" › Browser). Right-click a pane\'s name for its actions, twice to rename it; double-click it to maximize.'],
  ['Side panel', "A worktree's right panel. It always has Dashboard, Changes (every file the agents or you changed: uncommitted, the whole branch, one commit or one chat turn, with line counts and diffs), Sessions (the agents' conversation history, from the machine the Workspace lives on), Explorer (files), Schedules (a calendar of the Workspace's scheduled agents) and Workspace settings; drag a tab into the lower half for a dual view."],
  ['Dashboard', "The workspace page in the side panel. Tabs: Tasks (the board), Worktrees (changes and each branch's pull or merge request) and Issues (from GitHub, GitLab, Jira or Linear; start a worktree from one)."],
  ['Workspace settings', 'Name, icon, emoji or avatar (its own image, or its GitHub or GitLab avatar) and color; how new agents open (terminal or chat); chat models; branch prefix and base branch; code host and issue source.'],
  ['Settings › Appearance', 'In sections: Theme (Dark, Bronze, Silver, then VS Code color themes); Background (wallpaper, transparency, blur, dim); Terminal font.'],
  ['Settings › Agents', 'Hiveory tools for agents, default auto-approve and chat view, computer use, keep running in the background, Terminal host (keep agents running when Hiveory quits, keep them for, restart), Pluto (download the separate desktop pet that shows every agent session on this computer, and whether it may see the agents here).'],
  ['Settings › Browser', 'Browser use for agents, the agent cursor, home page, profiles and viewport sizes.'],
  ['Settings › Skills, MCPs & Apps', 'Skills across every CLI (and skills.sh to find more), MCP servers Hiveory runs for every agent (and the MCP Registry), and apps through Composio.'],
  ['Settings › Integrations', 'GitHub and GitLab sign-in status (gh, glab) and Jira or Linear keys.'],
  ['Settings › Remote', 'Share this computer over Tailscale or the local network, pair the phone, SSH hosts and Hiveory servers.'],
  ['Settings › Keyboard', 'Every shortcut, with the platform standard keys (⌘ on macOS, Ctrl on Windows and Linux): Settings, sidebar, side panel, worktrees, panes and tabs. Change, remove or reset each; fixed terminal and editor keys are listed too.'],
  ['Settings › Updates', 'Check for updates and how often.'],
  ['Settings › Guide', 'A short chapter for every part of the app: getting started, worktrees and Git, panes, the Kanban, the browser, schedules, skills and apps, integrations, remote and phone, keyboard, appearance and troubleshooting.']
]

/** The guide as plain lines: "Place: what is there." */
export const appGuideText = (): string => APP_GUIDE.map(([place, what]) => `${place}: ${what}`).join('\n')
