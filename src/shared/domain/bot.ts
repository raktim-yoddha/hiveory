/**
 * Bots mode (ADR 0022): persistent AI teammates. A bot is an identity that
 * outlives any engine; its conversations are threads (chats tagged with the
 * bot's id), so Bots and Chat share one conversation engine.
 */
export interface Bot {
  id: string
  name: string
  /** What the bot owns, the standards it keeps and when it stops to ask. */
  brief: string
  /** Default engine and model for new threads; each thread may pick its own before it starts. */
  cliId?: string
  model?: string
  effort?: string
  /** Default permission for new threads: full access (edits files, runs commands) or read-only. */
  autoApprove: boolean
  /**
   * Chief of Staff: its team's head and the user's contact for that team. It can list the
   * team, delegate work to its bots and consult them, and receives their results. One per team (ADR 0028).
   */
  chief: boolean
  /** The team it belongs to (General unless moved). */
  teamId: string
  /** May consult other bots (and be consulted). The Chief can always reach every bot. */
  messaging: boolean
  /** Durable facts the bot carries into every new thread. The user can read and edit them. */
  memory: string[]
  pinned: boolean
  /** May run on a schedule (routines). Off until the user allows it (ADR 0028). */
  routines: boolean
  /** Where the bot may use a computer (the bot panel's "Works on"). Which tools its threads get follows from it: see bot-reach. */
  worksOn: WorksOn
  /** The bot's own Linux computer: a Docker container here, or on an SSH host (ADR 0022). Absent = none set up. */
  computer?: BotComputer
  /** The browser profile its pages open in, so its logins stay apart from the user's. Made on first use. */
  browserProfileId?: string
  createdAt: string
  updatedAt: string
}

/**
 * auto: the built-in browser, plus its Linux computer when one is set up (never the user's screen) ·
 * container: only its Linux computer · this-computer: only the user's real screen, chosen on purpose ·
 * browser: only the built-in browser · off: chat and apps only.
 */
export const WORKS_ON = ['auto', 'container', 'this-computer', 'browser', 'off'] as const
export type WorksOn = (typeof WORKS_ON)[number]

export interface BotComputer {
  kind: 'docker'
  /** Docker on another machine, reached through Hiveory's SSH host. Absent = this computer. */
  host?: { kind: 'ssh'; destination: string; port?: number }
}

export type BotComputerState = 'off' | 'unavailable' | 'missing' | 'stopped' | 'running'

export interface BotComputerStatus {
  state: BotComputerState
  /** Why it is unavailable, or what is happening. */
  detail?: string
  /** Where "take control" opens (loopback only). */
  url?: string
}

/** A bot as the renderer sees it: its home folder and live thread counts. */
export interface BotView extends Bot {
  /** The folder every thread of this bot works in. */
  home: string
  threads: number
  running: number
  lastActivity?: string
}

/** A named group of bots with its own Chief of Staff (ADR 0028). General always exists. */
export interface Team {
  id: string
  name: string
  createdAt: string
}

export const GENERAL_TEAM: Team = { id: 'general', name: 'General', createdAt: '1970-01-01T00:00:00.000Z' }
export const MAX_TEAM_NAME = 40

/** Work one bot handed another (a delegated or consulted thread): the team map's live lines. */
export interface Handoff {
  fromBotId: string
  toBotId: string
  threadId: string
  title: string
  running: boolean
  updatedAt: string
}

/** At most one Chief per team: the first one found keeps it (a hand-edited file, a merged team). */
export function oneChiefPerTeam<B extends Pick<Bot, 'chief' | 'teamId'>>(bots: B[]): B[] {
  const led = new Set<string>()
  return bots.map((b) => {
    if (!b.chief) return b
    if (led.has(b.teamId)) return { ...b, chief: false }
    led.add(b.teamId)
    return b
  })
}

/** The browser scope all of a bot's threads share: its pages, shown in the bot panel's Browser tab. */
export const botScope = (botId: string): string => `bot-${botId}`

export const MAX_BOT_NAME = 60
export const MAX_BOT_BRIEF = 4000
export const MAX_BOT_MEMORY = 50
export const MAX_MEMORY_ENTRY = 300
/** A delegated thread may delegate once more, never deeper: no loops between bots. */
export const MAX_DELEGATION_DEPTH = 2
