/**
 * What Hiveory is and where everything lives, in the user's words (ADR 0041). One source for every
 * agent's `hiveory_about` tool and for Queen Bee, so they answer "where do I…" questions the same way.
 * Product facts only: never user data, paths or settings values.
 */
export const APP_GUIDE: ReadonlyArray<readonly [place: string, what: string]> = [
  ['Hiveory', 'A desktop app that runs coding-agent CLIs (Claude Code, Codex, Gemini, OpenCode and more) side by side. Three modes in the title bar: Work, Bots and Chat. A phone app pairs with it.'],
  ['Workspace', 'A folder or Git repository in the Work sidebar. Its mark folds its worktrees; right-click for its settings.'],
  ['Worktree', 'The Primary (the workspace folder itself) or an isolated branch folder made by "+" (new, existing or remote branch). Each holds agent and terminal panes.'],
  ['Agents', 'Each pane runs one CLI instance with a pet name. Its status is Idle, Working or Waiting for you; the sidebar bar under a worktree shows them. Panes split right or bottom and can be dragged.'],
  ['Side panel', "A worktree's right panel. It starts with Dashboard, Sessions (the agents' conversation history) and Explorer (files); \"+\" adds Routines (scheduled agents) and Workspace settings."],
  ['Dashboard', "The workspace page in the side panel. Tabs: Tasks (the board), Worktrees (changes and each branch's pull or merge request) and Issues (from GitHub, GitLab, Jira or Linear; start a worktree from one)."],
  ['Workspace settings', 'Name, icon and color; how new agents open (terminal or chat); chat models; branch prefix and base branch; code host and issue source.'],
  ['Bots', 'Bots mode: assistants with threads, teams and a Chief of Staff, routines on a calendar, triggers from connected apps, the work board and the team map.'],
  ['Chat', 'Chat mode: conversations with a CLI in a chat view, read-only by default; schedule one as a routine.'],
  ['Queen Bee', 'The voice and text operator: opens, messages and reports on agents, navigates and changes a few settings. Her shortcut is in Settings › Queen Bee.'],
  ['Settings › Appearance', 'Themes, wallpaper, transparency, VS Code color themes and the terminal font.'],
  ['Settings › Agents', 'Hiveory tools for agents, default auto-approve and chat view, computer use, keep running in the background.'],
  ['Settings › Browser', 'Browser use for agents, the agent cursor, home page, profiles and viewport sizes.'],
  ['Settings › Skills, MCP & Apps', 'Skills across every CLI (and skills.sh to find more), MCP servers Hiveory runs for every agent (and the MCP Registry), and apps through Composio.'],
  ['Settings › Integrations', 'GitHub and GitLab sign-in status (gh, glab) and Jira or Linear keys.'],
  ['Settings › Remote', 'Share this computer over Tailscale or the local network, pair the phone, SSH hosts and Hiveory servers.'],
  ['Settings › Updates', 'Check for updates and how often.']
]

/** The guide as plain lines: "Place: what is there." */
export const appGuideText = (): string => APP_GUIDE.map(([place, what]) => `${place}: ${what}`).join('\n')
