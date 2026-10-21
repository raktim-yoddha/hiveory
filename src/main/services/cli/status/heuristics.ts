import type { WaitingReason } from '@shared/domain'
import type { StatusEvent } from './status-machine'

/**
 * Fallback status detection from PTY traffic for CLIs without native hooks
 * (ADR 0006). Deliberately conservative: it only reports transitions it can
 * justify from observed input/output.
 */
export interface HeuristicConfig {
  /** Output patterns meaning the CLI is blocked on the user. */
  waitingPatterns: Array<{ pattern: RegExp; reason: WaitingReason }>
  /** Treat a submitted line (Enter) as the start of work. */
  workingOnSubmit: boolean
  /** Output silence after which a working CLI is considered idle. 0 disables. */
  idleAfterSilenceMs: number
  /** Output patterns meaning the current turn ended (e.g. a user interrupt). */
  idlePatterns?: RegExp[]
}

type Phase = 'idle' | 'working' | 'waiting'

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g
// eslint-disable-next-line no-control-regex
const CURSOR_FORWARD = /\u001b\[(\d*)C/g
// eslint-disable-next-line no-control-regex
const CURSOR_COLUMN = /\u001b\[\d*G/g
// eslint-disable-next-line no-control-regex
const CURSOR_POSITION = /\u001b\[\d*(?:;\d*)?[Hf]/g

/**
 * Plain text from terminal output. Windows ConPTY encodes spaces as
 * cursor-forward and line breaks as cursor positioning, and TUIs jump to a
 * column between words, so those become whitespace before the remaining
 * escapes are dropped.
 */
export const stripAnsi = (text: string): string =>
  text
    .replace(CURSOR_FORWARD, (_m, n: string) => ' '.repeat(Math.min(Number(n) || 1, 200)))
    .replace(CURSOR_POSITION, '\n')
    .replace(CURSOR_COLUMN, ' ')
    .replace(ANSI, '')

const TAIL_LIMIT = 4000
/**
 * After the user answers a prompt, its last frames are often drawn once more before the CLI
 * removes it; output this soon after an answer never counts as a new prompt (ADR 0049).
 */
const ANSWER_GRACE_MS = 1500

/** Keys that answer a prompt: Enter, Esc, Ctrl+C, and, for a permission or confirmation, a choice key. */
const isAnswer = (data: string, reason: WaitingReason | undefined): boolean =>
  // eslint-disable-next-line no-control-regex
  /[\r\n\u0003]/.test(data) || data === '\u001b' || (reason !== 'input' && /^[0-9yYnN]$/.test(data))

export const GENERIC_WAITING_PATTERNS: HeuristicConfig['waitingPatterns'] = [
  { pattern: /\((?:y\/n|yes\/no)\)|\[y\/N\]|\[Y\/n\]/i, reason: 'confirmation' }
]

/**
 * Prompts are found in fresh output, then confirmed against the rendered screen (`screen`, the
 * visible rows as text) on the next tick, so a frame that flashed by or text that only quotes a
 * prompt never counts. A prompt it found ends when the user answers it or it leaves the screen.
 * Without a screen, fresh output alone decides (ADR 0049).
 */
export class HeuristicDetector {
  private tail = ''
  private lastOutputAt = 0
  private phase: Phase = 'idle'
  private reason: WaitingReason | undefined
  /** A prompt seen in fresh output, waiting for the screen to confirm it. */
  private candidate = false
  /** The waiting is this detector's own (found on screen), not one a hook reported. */
  private ownWaiting = false
  private quietUntil = 0

  constructor(
    private readonly config: HeuristicConfig,
    private readonly screen?: () => string
  ) {}

  onInput(data: string, now: number): StatusEvent | null {
    if (this.phase === 'waiting' && isAnswer(data, this.reason)) {
      // The prompt is answered: back to work until output or silence says otherwise.
      this.reset('working')
      this.lastOutputAt = now
      this.quietUntil = now + ANSWER_GRACE_MS
      return { type: 'working' }
    }
    if (!data.includes('\r') && !data.includes('\n')) return null
    // A submitted line invalidates whatever prompt text was on screen.
    this.tail = ''
    this.candidate = false
    if (!this.config.workingOnSubmit) return null
    this.phase = 'working'
    this.lastOutputAt = now
    return { type: 'working' }
  }

  onOutput(data: string, now: number): StatusEvent | null {
    this.lastOutputAt = now
    if (now < this.quietUntil) return null
    this.tail = (this.tail + stripAnsi(data)).slice(-TAIL_LIMIT)
    if (this.phase !== 'idle' && this.config.idlePatterns?.some((p) => p.test(this.tail))) {
      this.reset('idle')
      return { type: 'turn-complete' }
    }
    if (this.phase === 'waiting' || !this.match(this.tail)) return null
    if (this.screen) {
      this.candidate = true
      return null
    }
    return this.enterWaiting(this.match(this.tail)!)
  }

  tick(now: number): StatusEvent | null {
    const shown = this.visible()
    if (this.candidate) {
      this.candidate = false
      const reason = this.match(shown ?? this.tail)
      if (reason && this.phase !== 'waiting') return this.enterWaiting(reason)
      this.tail = ''
    }
    // A prompt this detector found is gone from the screen: the CLI moved on.
    if (this.phase === 'waiting' && this.ownWaiting && shown !== null && !this.match(shown)) {
      this.reset('working')
      this.lastOutputAt = now
      return { type: 'working' }
    }
    const { idleAfterSilenceMs } = this.config
    if (this.phase !== 'working' || idleAfterSilenceMs <= 0) return null
    if (now - this.lastOutputAt < idleAfterSilenceMs) return null
    this.phase = 'idle'
    return { type: 'turn-complete' }
  }

  /**
   * Keeps the detector in sync when an authoritative source (hooks) changes status. A turn
   * the hooks just started counts its silence from now: an agent that sat quiet before the
   * prompt must not be called idle on the next tick.
   */
  sync(phase: Phase, now = Date.now(), reason?: WaitingReason): void {
    if (phase === 'working' && this.phase !== 'working') this.lastOutputAt = now
    this.phase = phase
    this.reason = reason
    this.ownWaiting = false
    this.candidate = false
    if (phase !== 'waiting') this.tail = ''
  }

  private reset(phase: Phase): void {
    this.phase = phase
    this.reason = undefined
    this.ownWaiting = false
    this.candidate = false
    this.tail = ''
  }

  private enterWaiting(reason: WaitingReason): StatusEvent {
    this.phase = 'waiting'
    this.reason = reason
    this.ownWaiting = true
    return { type: 'needs-user', reason }
  }

  private match(text: string): WaitingReason | undefined {
    // A prompt wrapped inside a TUI box reads as one line: borders and line breaks become one space.
    const flat = text.replace(/[\u2500-\u257f\s]+/g, ' ')
    return this.config.waitingPatterns.find(({ pattern }) => pattern.test(flat))?.reason
  }

  /** The rendered screen as text, or null when there is none to read. */
  private visible(): string | null {
    return this.screen?.() || null
  }
}
