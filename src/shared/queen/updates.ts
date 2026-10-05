import type { CliStatus, WaitingReason } from '../domain'

/**
 * Queen Bee's live updates (ADR 0019): what an agent just did, whether anyone
 * asked her or not. Computed in main from real status changes; the renderer
 * phrases them in the personality's voice and may say them out loud.
 */
export interface QueenUpdate {
  /** finished: was working, now idle. waiting: needs you. stopped: its process ended with an error. */
  kind: 'finished' | 'waiting' | 'stopped'
  instanceId: string
  petName: string
  cliName: string
  projectId: string
  workspaceId: string
  workspaceName: string
  /** Why it waits (permission, input…) or the error that stopped it. */
  reason?: string
  /** The last meaningful words on its screen, or its last chat reply. Labelled as such, never rephrased. */
  excerpt?: string
  /** How long it worked before finishing. */
  workedSeconds?: number
}

/** One agent up close, for "what is Bruno doing?". */
export interface QueenPeek {
  petName: string
  status: CliStatus
  running: boolean
  waitingReason?: WaitingReason
  activity?: string
  excerpt?: string
}

/** Lines that are a TUI's frame, not what the agent said: borders, hints, status bars, the empty input box. */
const CHROME =
  /^[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝▌▐█░▒▓·•…\-_=*~^]*$|\besc to\b|enter to (confirm|select|submit|send)|\? for shortcuts|ctrl\s*\+|shift\s*\+\s*tab|tokens?\b.*\b(left|used)|context (left|window)|auto-accept|bypass permissions|accept edits|plan mode|press enter|type your message|send a message|^\s*[>›❯$#%]\s*$|^\s*[>›❯]\s+\S{0,2}$|^\s*\d+%\s/i

/**
 * The last meaningful words on an agent's screen: frame lines and hints are
 * skipped, bullets trimmed, at most two lines and 220 characters. A plain
 * excerpt — what the agent itself wrote — not a summary.
 */
export function lastWords(screen: string): string | undefined {
  const lines = screen
    .split(/\r?\n/)
    .map((l) => l.replace(/[│┃║]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 1 && /\p{L}/u.test(l) && !CHROME.test(l))
    .map((l) => l.replace(/^[⏺●•◆◇✻✶✳∴⎿└├>›❯*\-–]+\s*/u, '').trim())
    // Narrow panes wrap hints into scraps ("Esc to" / "cancel"): keep sentences, not fragments.
    .filter((l) => l.split(' ').length >= 3 || /[.!?:]$/.test(l))
  if (!lines.length) return undefined
  const text = lines.slice(-2).join(' ')
  return text.length > 220 ? `${text.slice(0, 219)}…` : text
}
