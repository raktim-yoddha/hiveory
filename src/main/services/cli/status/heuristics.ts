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

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g
// eslint-disable-next-line no-control-regex
const CURSOR_FORWARD = /\u001b\[(\d*)C/g
// eslint-disable-next-line no-control-regex
const CURSOR_POSITION = /\u001b\[\d*(?:;\d*)?[Hf]/g

/**
 * Plain text from terminal output. Windows ConPTY encodes spaces as
 * cursor-forward and line breaks as cursor positioning, so those become
 * whitespace before the remaining escapes are dropped.
 */
export const stripAnsi = (text: string): string =>
  text
    .replace(CURSOR_FORWARD, (_m, n: string) => ' '.repeat(Math.min(Number(n) || 1, 200)))
    .replace(CURSOR_POSITION, '\n')
    .replace(ANSI, '')

const TAIL_LIMIT = 4000

export const GENERIC_WAITING_PATTERNS: HeuristicConfig['waitingPatterns'] = [
  { pattern: /\((?:y\/n|yes\/no)\)|\[y\/N\]|\[Y\/n\]/i, reason: 'confirmation' }
]

export class HeuristicDetector {
  private tail = ''
  private lastOutputAt = 0
  private phase: 'idle' | 'working' | 'waiting' = 'idle'

  constructor(private readonly config: HeuristicConfig) {}

  onInput(data: string, now: number): StatusEvent | null {
    if (!data.includes('\r') && !data.includes('\n')) return null
    // A submitted answer invalidates whatever prompt text was on screen.
    this.tail = ''
    if (!this.config.workingOnSubmit && this.phase !== 'waiting') return null
    this.phase = 'working'
    this.lastOutputAt = now
    return { type: 'working' }
  }

  onOutput(data: string, now: number): StatusEvent | null {
    this.lastOutputAt = now
    this.tail = (this.tail + stripAnsi(data)).slice(-TAIL_LIMIT)
    if (this.phase !== 'idle' && this.config.idlePatterns?.some((p) => p.test(this.tail))) {
      this.phase = 'idle'
      this.tail = ''
      return { type: 'turn-complete' }
    }
    if (this.phase === 'waiting') return null
    const match = this.config.waitingPatterns.find(({ pattern }) => pattern.test(this.tail))
    if (match) {
      this.phase = 'waiting'
      return { type: 'needs-user', reason: match.reason }
    }
    return null
  }

  tick(now: number): StatusEvent | null {
    const { idleAfterSilenceMs } = this.config
    if (this.phase !== 'working' || idleAfterSilenceMs <= 0) return null
    if (now - this.lastOutputAt < idleAfterSilenceMs) return null
    this.phase = 'idle'
    return { type: 'turn-complete' }
  }

  /** Keeps the detector in sync when an authoritative source (hooks) changes status. */
  sync(phase: 'idle' | 'working' | 'waiting'): void {
    this.phase = phase
    if (phase !== 'waiting') this.tail = ''
  }
}
