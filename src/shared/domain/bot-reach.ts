import type { Bot } from './bot'

/** The computer tool families a bot thread can be given: browser_*, desktop_* (its Linux computer), computer_* (the user's screen). */
export type ReachFamily = 'browser' | 'desktop' | 'computer'

/** What this app allows overall: Settings › Browser use, and Settings › Computer use where it is supported. */
export interface ReachSwitches {
  browser: boolean
  computer: boolean
}

/**
 * The tool families a bot's threads get, from its "Works on" choice and the app's switches.
 * One function for the tools and the bot panel, so what the panel says is what the bot can do.
 * Auto never reaches the user's real screen: that takes "This computer", chosen on purpose.
 */
export function botReach(bot: Pick<Bot, 'worksOn' | 'computer'>, on: ReachSwitches): ReachFamily[] {
  switch (bot.worksOn) {
    case 'off':
      return []
    case 'browser':
      return on.browser ? ['browser'] : []
    case 'container':
      return bot.computer ? ['desktop'] : []
    case 'this-computer':
      return on.computer ? ['computer'] : []
    case 'auto':
      return [...(on.browser ? (['browser'] as const) : []), ...(bot.computer ? (['desktop'] as const) : [])]
  }
}
