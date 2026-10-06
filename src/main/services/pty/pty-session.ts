import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import * as pty from '@lydell/node-pty'
import type { Terminal as HeadlessTerminalType } from '@xterm/headless'
import { OutputBuffer } from './output-buffer'

// @xterm/headless is CommonJS; load it explicitly so the ESM main bundle gets the real class.
const { Terminal: HeadlessTerminal } = createRequire(import.meta.url)('@xterm/headless') as {
  Terminal: typeof HeadlessTerminalType
}

export interface PtySpawnSpec {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

export interface PtySessionEvents {
  /** Coalesced output; `offset` is where the chunk starts in the session's output stream. */
  data: [data: string, offset: number]
  /** Raw output chunk, before coalescing (for status detection). */
  raw: [data: string]
  exit: [code: number | null, signal: number | null]
  error: [error: Error]
}

/** Longest wait for a terminal size before spawning anyway (pane not visible). */
const SPAWN_FALLBACK_MS = 600
/** Output is coalesced for this long, so one TUI frame is one IPC message. */
const FLUSH_MS = 4
const DEFAULT_SIZE = { cols: 120, rows: 32 }
const MIRROR_SCROLLBACK = 2000

/**
 * One pseudo-terminal process with everything a pane needs: spawn deferred
 * until the real size is known, coalesced output, bounded scrollback for
 * replay, and a headless terminal mirror so the visible screen can be read as
 * plain text (used by agent tools). Kill never blocks the caller.
 */
export class PtySession extends EventEmitter<PtySessionEvents> {
  private process: pty.IPty | null = null
  private pending: { spec: PtySpawnSpec; timer: NodeJS.Timeout } | null = null
  private size: { cols: number; rows: number } | null = null
  private readonly buffer = new OutputBuffer()
  private outbox: { data: string; offset: number } | null = null
  private mirror: HeadlessTerminalType | null = null

  constructor(private readonly withMirror = false) {
    super()
  }

  get running(): boolean {
    return Boolean(this.process || this.pending)
  }

  get hasProcess(): boolean {
    return Boolean(this.process)
  }

  /** Prepares a spawn; the process starts on the first `resize` (or after a short fallback). */
  start(spec: PtySpawnSpec): void {
    this.stop()
    this.pending = { spec, timer: setTimeout(() => this.spawnNow(), SPAWN_FALLBACK_MS) }
    if (this.size) this.spawnNow()
  }

  write(data: string): void {
    if (this.pending) this.spawnNow()
    this.process?.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this.size?.cols === cols && this.size.rows === rows) return
    this.size = { cols, rows }
    this.mirror?.resize(cols, rows)
    if (this.pending) return this.spawnNow()
    try {
      this.process?.resize(cols, rows)
    } catch {
      // Resizing a process that is exiting can throw; it is never fatal.
    }
  }

  /** Stops the process without waiting for ConPTY teardown. Returns true if something was running. */
  stop(): boolean {
    const wasRunning = this.running
    if (this.pending) clearTimeout(this.pending.timer)
    this.pending = null
    const child = this.process
    this.process = null
    if (child) {
      setImmediate(() => {
        try {
          child.kill()
        } catch {
          // Already gone.
        }
      })
    }
    return wasRunning
  }

  /** Synchronous kill for app shutdown. */
  killNow(): void {
    if (this.pending) clearTimeout(this.pending.timer)
    this.pending = null
    try {
      this.process?.kill()
    } catch {
      // Quitting.
    }
    this.process = null
    this.mirror?.dispose()
    this.mirror = null
  }

  /** Appends text that did not come from the process (e.g. a restart marker). */
  annotate(text: string): void {
    this.append(text)
  }

  /** Whether the program enabled bracketed paste (so pasted newlines don't submit). */
  get bracketedPaste(): boolean {
    return Boolean(this.mirror?.modes.bracketedPasteMode)
  }

  snapshot(): { data: string; end: number } {
    this.flush()
    return this.buffer.snapshot()
  }

  /** The last `lines` lines of the rendered screen as plain text (requires `withMirror`). */
  screenText(lines: number): string {
    const term = this.mirror
    if (!term) return ''
    const buf = term.buffer.active
    const end = buf.baseY + term.rows
    const start = Math.max(0, end - lines)
    const out: string[] = []
    for (let y = start; y < end; y++) out.push(buf.getLine(y)?.translateToString(true) ?? '')
    while (out.length && !out[out.length - 1]?.trim()) out.pop()
    return out.join('\n')
  }

  private spawnNow(): void {
    const pending = this.pending
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending = null
    const { cols, rows } = this.size ?? DEFAULT_SIZE
    if (this.withMirror && !this.mirror) {
      this.mirror = new HeadlessTerminal({ cols, rows, scrollback: MIRROR_SCROLLBACK, allowProposedApi: true })
    }
    try {
      const child = pty.spawn(pending.spec.file, pending.spec.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: pending.spec.cwd,
        env: pending.spec.env,
        // Bundled modern ConPTY renders far more faithfully than the inbox Windows one.
        ...(process.platform === 'win32' ? { useConptyDll: true } : {})
      })
      this.process = child
      child.onData((data) => {
        this.append(data)
        this.emit('raw', data)
      })
      child.onExit(({ exitCode, signal }) => {
        if (this.process !== child) return
        this.process = null
        this.flush()
        this.emit('exit', exitCode, signal ?? null)
      })
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      // An 'error' event with no listener would throw out of a timer or an IPC call; say it in the terminal instead.
      if (this.listenerCount('error') > 0) this.emit('error', failure)
      else this.annotate(`\r\n\x1b[31mCould not start: ${failure.message}\x1b[0m\r\n`)
    }
  }

  private append(data: string): void {
    const offset = this.buffer.append(data)
    this.mirror?.write(data)
    if (this.outbox) {
      this.outbox.data += data
      return
    }
    this.outbox = { data, offset }
    setTimeout(() => this.flush(), FLUSH_MS)
  }

  private flush(): void {
    const outbox = this.outbox
    if (!outbox) return
    this.outbox = null
    this.emit('data', outbox.data, outbox.offset)
  }
}
