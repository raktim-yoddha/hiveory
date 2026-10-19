/**
 * What Queen Bee can do, as one reference (ADR 0019): her help answer is built
 * from it in her personality's voice, and models get the same list, so every
 * provider describes her the same way. Add a line here when she learns something.
 */
export interface QueenCapability {
  area: string
  what: string
  examples: string[]
  /** Only with a model provider set up. */
  needsModel?: boolean
}

export const QUEEN_CAPABILITIES: QueenCapability[] = [
  { area: 'Agents', what: 'open, close, restart or stop coding agents, and send them your exact words', examples: ['open two Claude in feature-x', 'Bruno, fix the failing build', 'stop Bruno'] },
  { area: 'Status', what: 'who is working, idle or waiting on you, and what one agent is doing', examples: ['status of everything', 'what is Luna doing?', 'take me to whoever needs me'] },
  { area: 'Workspaces and worktrees', what: 'switch workspaces and worktrees, create worktrees, load or save presets', examples: ['go to demo website', 'create a worktree called login-fix', 'save this as preset Backend'] },
  { area: 'Panes', what: 'lay out, move, swap and resize agent panes', examples: ['put them side by side', 'make Bruno bigger', 'swap Bruno and Luna'] },
  { area: 'Pages', what: 'Home, Settings, Chat, and Bots (work board, schedules, triggers, team map)', examples: ['open the work board', 'new chat with Codex about the API', 'open Settings'] },
  { area: 'Code', what: 'branch and changes, open pull requests, files and pages in the side browser', examples: ['what changed', 'show open PRs', 'open README.md', 'open localhost:3000'] },
  { area: 'Bots and schedules', what: 'message a bot, pause or resume a schedule or trigger', examples: ['pause Morning brief'] },
  { area: 'Settings and notes', what: 'theme, voice, app settings, connected apps, updates, and notes I keep about you', examples: ['bronze theme', 'mute', 'which apps are connected', 'remember that I review with Claude'] },
  {
    area: 'Several steps at once',
    what: 'one request with many steps, done in order, in your own words',
    examples: ['open demo website, make a worktree called secondary, then two Claude side by side', "let's hop into Bots"],
    needsModel: true
  }
]

/** The reference as plain lines, for a model's instructions. */
export const capabilitiesText = (): string => QUEEN_CAPABILITIES.map((c) => `- ${c.area}: ${c.what} (e.g. ${c.examples.map((e) => `"${e}"`).join(', ')})`).join('\n')
