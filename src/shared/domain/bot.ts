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
   * Chief of Staff: the team's head and the user's single contact. It can list the
   * team, delegate work to bots and consult them, and receives their results. At most one.
   */
  chief: boolean
  /** May consult other bots (and be consulted). The Chief can always reach every bot. */
  messaging: boolean
  /** Durable facts the bot carries into every new thread. The user can read and edit them. */
  memory: string[]
  pinned: boolean
  createdAt: string
  updatedAt: string
}

/** A bot as the renderer sees it: its home folder and live thread counts. */
export interface BotView extends Bot {
  /** The folder every thread of this bot works in. */
  home: string
  threads: number
  running: number
  lastActivity?: string
}

export const MAX_BOT_NAME = 60
export const MAX_BOT_BRIEF = 4000
export const MAX_BOT_MEMORY = 50
export const MAX_MEMORY_ENTRY = 300
/** A delegated thread may delegate once more, never deeper: no loops between bots. */
export const MAX_DELEGATION_DEPTH = 2
