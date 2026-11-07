/**
 * What Queen Bee can do, as one reference (ADR 0019): her help answer is built
 * from it in her personality's voice, and models get the same list, so every
 * provider describes her the same way. Add a line here when she learns something.
 */
export interface QueenCapability {
  area: string
  what: string
  examples: string[]
  /** The same, said aloud: a phrase that follows "I can" in her spoken answer. */
  say: string
  /** Only with a model provider set up. */
  needsModel?: boolean
}

export const QUEEN_CAPABILITIES: QueenCapability[] = [
  { area: 'Agents', what: 'open, close, restart or stop coding agents, and send them your exact words', examples: ['open two Claude in feature-x', 'Bruno, fix the failing build', 'stop Bruno'], say: 'open, stop or restart your coding agents and pass them your messages' },
  { area: 'Status', what: 'who is working, idle or needs you, and what one agent is doing', examples: ['status of everything', 'what is Luna doing?', 'take me to whoever needs me'], say: 'tell you who is working, who is idle and who needs you' },
  { area: 'Workspaces and worktrees', what: 'switch workspaces and worktrees, create worktrees, load or save presets', examples: ['go to demo website', 'create a worktree called login-fix', 'save this as preset Backend'], say: 'take you to any workspace or worktree, make new worktrees and load your presets' },
  { area: 'Panes', what: 'lay out, move, swap and resize agent panes', examples: ['put them side by side', 'make Bruno bigger', 'swap Bruno and Luna'], say: 'arrange and resize their panes' },
  { area: 'Pages', what: 'Home and Settings', examples: ['go home', 'open Settings'], say: 'take you Home or to Settings' },
  { area: 'Code', what: 'branch and changes, open pull requests, files and pages in the side browser', examples: ['what changed', 'show open PRs', 'open README.md', 'open localhost:3000'], say: 'check your branch, changes and pull requests' },
  { area: 'Schedules', what: 'pause or resume a schedule', examples: ['pause Morning brief'], say: 'pause or resume your schedules' },
  { area: 'Settings and notes', what: 'theme, voice, app settings, connected apps, updates, and notes I keep about you', examples: ['bronze theme', 'mute', 'which apps are connected', 'remember that I review with Claude'], say: 'change your theme and settings and keep notes about how you work' },
  {
    area: 'Several steps at once',
    what: 'one request with many steps, done in order, in your own words',
    examples: ['open demo website, make a worktree called secondary, then two Claude side by side'],
    say: 'do a whole request of several steps in one go, however you phrase it',
    needsModel: true
  }
]

/** The reference as plain lines, for a model's instructions. */
export const capabilitiesText = (): string => QUEEN_CAPABILITIES.map((c) => `- ${c.area}: ${c.what} (e.g. ${c.examples.map((e) => `"${e}"`).join(', ')})`).join('\n')
