import type { BotView } from '@shared/domain/bot'
import { botReach, type ReachSwitches } from '@shared/domain/bot-reach'
import type { RoutineView } from '@shared/domain/routine'
import { when } from '../routines/routine-text'

export interface BotOverview {
  does: string[]
  reach: string[]
  wont: string[]
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * What a bot does, can reach and won't do, in plain sentences, worked out from its settings (and the same
 * botReach the tools use), so the Overview never claims more or less than the bot can actually do.
 */
export function botOverview(
  bot: BotView,
  c: { teamName: string; teamCount: number; routines: RoutineView[]; switches: ReachSwitches; /** The bot whose computer it shares, by name. */ seatOn?: string }
): BotOverview {
  const does: string[] = []
  if (bot.chief) does.push(`Leads the ${c.teamName} team: hands work to its bots and brings the results back.`)
  else if (c.teamCount > 1) does.push(`Works in the ${c.teamName} team.`)
  const on = c.routines.filter((r) => r.enabled)
  const next = on
    .map((r) => r.nextRunAt)
    .filter((t): t is string => Boolean(t))
    .sort()[0]
  if (on.length) does.push(`${plural(on.length, 'routine')} on${next ? `, next ${when(next)}` : ''}.`)
  else if (c.routines.length) does.push(`${plural(c.routines.length, 'routine')}, all paused.`)
  else does.push('Nothing scheduled yet.')
  does.push(bot.memory.length ? `Remembers ${plural(bot.memory.length, 'note')}.` : 'Remembers nothing yet.')

  const reach: string[] = []
  for (const family of botReach(bot, c.switches)) {
    if (family === 'browser') reach.push('The built-in browser, signed in as itself.')
    if (family === 'desktop')
      reach.push(
        bot.computer?.kind === 'shared'
          ? `A seat on ${c.seatOn ?? 'another bot'}'s Linux computer, one conversation at a time.`
          : bot.computer?.host
            ? `Its Linux computer on ${bot.computer.host.destination}.`
            : 'Its Linux computer, in Docker or Podman on this computer.'
      )
    if (family === 'computer') reach.push('Your screen and apps.')
  }
  reach.push('The apps and MCP servers you connected.')
  reach.push(`Its own folder: ${bot.home}`)
  if (bot.chief) reach.push('Every bot in its team, and through General, other teams.')
  else if (bot.messaging) reach.push("Other bots that allow messages, and its team's Chief.")
  if (bot.autoApprove) reach.push('Full access: it edits files and runs commands without asking.')

  const wont: string[] = []
  if (!bot.autoApprove) wont.push("Won't edit files or run commands without your approval.")
  if (bot.approvals === 'changes') wont.push("Won't change anything in your apps without asking.")
  else if (bot.approvals === 'sends') wont.push("Won't send or post as you without asking.")
  wont.push(bot.routines ? 'Routines it saves itself stay paused until you switch them on.' : "Won't act on a schedule.")
  if (bot.worksOn !== 'this-computer') wont.push("Won't touch your screen.")
  if (!bot.messaging && !bot.chief) wont.push("Won't message other bots.")
  return { does, reach, wont }
}
