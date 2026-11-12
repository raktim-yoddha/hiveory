import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { inProcessPty, type PtyBackend, type PtyHandle } from './pty-backend'
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
  /** On a remote host: start from that machine's environment, `env` on top. */
  inheritEnv?: boolean
  /** Who the terminal belongs to, so a daemon can hand it back after Hiveory restarts (ADR 0050). */
  key?: string
  /** Take back the daemon's kept terminal with this id instead of starting a process. */
  adopt?: string
}

export interface PtySessionEvents {
  /** Coalesced output; `offset` is where the chunk starts in the session's output stream. */
  data: [data: string, offset: number]
  /** Raw output chunk, before coalescing (for status detection). */
  raw: [data: string]
  exit: [code: number | null, signal: number | null]
  error: [error: Error]
  /** The link to the daemon running this terminal dropped (false) or came back (true). */
  link: [linked: boolean]
}

/** Longest wait for a terminal size before spawning anyway (pane not visible). */
const SPAWN_FALLBACK_MS = 600
/** Output is coalesced for this long, so one TUI frame is one IPC message. */
const FLUSH_MS = 4
const DEFAULT_SIZE = { cols: 120, rows: 32 }
const MIRROR_SCROLLBACK = 2000
/**
 * Least time between two resizes reaching the process; the last size always arrives. A burst
 * of resizes (dragging a divider or the window) crashes some TUIs: OpenCode's native renderer
 * segfaults (exit 3) on resizes ~40ms apart at small sizes, never at 100ms+ (measured).
 */
const RESIZE_INTERVAL_MS = 150
/**
 * Flow control (ADR 0067), with VS Code's numbers: the program is paused once the window has this
 * many characters of its output still to draw, and carries on when the window is nearly through them.
 */
export const FLOW_HIGH = 100_000
export const FLOW_LOW = 5_000
/** A window that stays silent this long while the program waits is gone or stuck: the program carries on without it. */
export const FLOW_STALL_MS = 2_000

/**
 * One pseudo-terminal process with everything a pane needs: spawn deferred
 * until the real size is known, coalesced output, bounded scrollback for
 * replay, and a headless terminal mirror so the visible screen can be read as
 * plain text (used by agent tools). Kill never blocks the caller.
 */
export class PtySession extends EventEmitter<PtySessionEvents> {
  private process: PtyHandle | null = null
  private pending: { spec: PtySpawnSpec; timer: NodeJS.Timeout } | null = null
  private size: { cols: number; rows: number } | null = null
  /** The size the desktop's pane asked for; a watching phone's size wins while it watches (ADR 0048). */
  private ownSize: { cols: number; rows: number } | null = null
  private readonly viewers = new Map<string, { cols: number; rows: number }>()
  private readonly buffer = new OutputBuffer()
  private outbox: { data: string; offset: number } | null = null
  private mirror: HeadlessTerminalType | null = null
  private lastResizeAt = 0
  private resizeTimer: NodeJS.Timeout | null = null
  /** A window draws this output and says how far it got (`ack`); false: nobody does, and the program never waits. */
  private watched = false
  /** Characters sent to that window that it has not drawn yet. */
  private unacked = 0
  private paused = false
  private stall: NodeJS.Timeout | null = null
  /** A window on this computer draws this terminal, and so answers its questions (ADR 0070). */
  private shown = false
  /** Replayed output being parsed: questions in it were asked long ago and are never answered. */
  private replaying = 0
  /** Whether a client elsewhere (a paired desktop) may be answering instead; set by the owner. */
  answeredElsewhere: () => boolean = () => false

  constructor(
    private readonly withMirror = false,
    /** Where the process runs: the host daemon in the app (ADR 0022), in-process by default. */
    private backend: PtyBackend = inProcessPty
  ) {
    super()
  }

  /** Where the next start runs: a remote agent restarted after a reconnect uses the new connection. */
  useBackend(backend: PtyBackend): void {
    this.backend = backend
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
    this.ownSize = { cols, rows }
    if (!this.viewers.size) this.setSize(cols, rows)
  }

  /**
   * A phone watching this terminal sizes it to its own screen until it stops (`null`); then the
   * newest phone still watching, or else the desktop's size, applies again (ADR 0048).
   */
  fitViewer(key: string, size: { cols: number; rows: number } | null): void {
    this.viewers.delete(key)
    if (size) this.viewers.set(key, size)
    // A terminal no pane ever sized went back to the size it started at.
    const next = [...this.viewers.values()].at(-1) ?? this.ownSize ?? DEFAULT_SIZE
    this.setSize(next.cols, next.rows)
  }

  private setSize(cols: number, rows: number): void {
    if (this.size?.cols === cols && this.size.rows === rows) return
    this.size = { cols, rows }
    this.mirror?.resize(cols, rows)
    if (this.pending) return this.spawnNow()
    if (this.resizeTimer) return
    const wait = this.lastResizeAt + RESIZE_INTERVAL_MS - Date.now()
    if (wait > 0) this.resizeTimer = setTimeout(() => this.applySize(), wait)
    else this.applySize()
  }

  /** Sends the latest size to the process (paced by `resize`). */
  private applySize(): void {
    this.resizeTimer = null
    this.lastResizeAt = Date.now()
    if (!this.size) return
    try {
      this.process?.resize(this.size.cols, this.size.rows)
    } catch {
      // Resizing a process that is exiting can throw; it is never fatal.
    }
  }

  /**
   * The window drew `chars` more characters of this terminal's output (ADR 0067). The first call
   * says a window is drawing it: from then on a program that prints faster than the window draws
   * waits for it, instead of filling memory and freezing the app.
   */
  ack(chars: number): void {
    if (!this.watched) {
      // What was sent before a window watched is not counted, so its acknowledgements are not either.
      this.watched = true
      this.unacked = 0
      return
    }
    this.unacked = Math.max(0, this.unacked - chars)
    if (!this.paused) return
    if (this.unacked < FLOW_LOW) this.carryOn()
    else this.armStall()
  }

  /**
   * Whether a window on this computer draws this terminal (ADR 0070). While none does, Hiveory's own
   * copy of the screen answers the program's questions (cursor position, device attributes), so a
   * program that asks never waits for an answer nobody sends: a shell typing back one character every
   * few seconds, an agent that never starts. A window answers for itself; answering twice would be
   * as wrong, since the second answer would reach the program as typed input.
   */
  setShown(shown: boolean): void {
    this.shown = shown
  }

  /** No window draws this terminal any more (it closed): the program never waits for one. */
  unwatch(): void {
    this.watched = false
    this.unacked = 0
    this.carryOn()
  }

  private carryOn(): void {
    if (this.stall) clearTimeout(this.stall)
    this.stall = null
    if (!this.paused) return
    this.paused = false
    try {
      this.process?.resume()
    } catch {
      // Exiting.
    }
  }

  private armStall(): void {
    if (this.stall) clearTimeout(this.stall)
    this.stall = setTimeout(() => this.unwatch(), FLOW_STALL_MS)
  }

  /** Stops the process without waiting for ConPTY teardown. Returns true if something was running. */
  stop(): boolean {
    const wasRunning = this.running
    this.settleFlow()
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.resizeTimer = null
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

  /**
   * Quitting with the terminal kept by its daemon (ADR 0050): lets go of the process without
   * ending it. Its output so far stays in `snapshot` for saving.
   */
  detach(): void {
    // The terminal host lets a paused terminal carry on when this app goes away (ADR 0067).
    this.settleFlow()
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.resizeTimer = null
    if (this.pending) clearTimeout(this.pending.timer)
    this.pending = null
    this.flush()
    this.process = null
    this.mirror?.dispose()
    this.mirror = null
  }

  /** Synchronous kill for app shutdown. */
  killNow(): void {
    this.settleFlow()
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.resizeTimer = null
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
    this.append(text, true)
  }

  /** Whether the program enabled bracketed paste (so pasted newlines don't submit). */
  get bracketedPaste(): boolean {
    return Boolean(this.mirror?.modes.bracketedPasteMode)
  }

  /** The output so far, and the terminal size it was drawn for (a phone draws it at that size, ADR 0027). */
  snapshot(): { data: string; end: number; cols: number; rows: number } {
    this.flush()
    return { ...this.buffer.snapshot(), ...(this.size ?? DEFAULT_SIZE) }
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

  /** The visible rows of the rendered screen as plain text, without scrollback (status detection). */
  visibleText(): string {
    return this.screenText(this.mirror?.rows ?? 0)
  }

  private spawnNow(): void {
    const pending = this.pending
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending = null
    const { cols, rows } = this.size ?? DEFAULT_SIZE
    // Spawning sets the first size; the next resize is paced from here.
    this.lastResizeAt = Date.now()
    if (this.withMirror && !this.mirror) {
      const mirror = new HeadlessTerminal({ cols, rows, scrollback: MIRROR_SCROLLBACK, allowProposedApi: true })
      // The copy's answers to the program's questions, sent only while nobody else can answer (ADR 0070).
      mirror.onData((answer) => {
        if (this.shown || this.replaying > 0 || this.answeredElsewhere()) return
        try {
          this.process?.write(answer)
        } catch {
          // Exiting.
        }
      })
      this.mirror = mirror
    }
    try {
      const child = this.backend.spawn({ ...pending.spec, cols, rows })
      this.process = child
      child.onData((data, replay) => {
        this.append(data, replay)
        this.emit('raw', data)
      })
      child.onExit(({ exitCode, signal }) => {
        if (this.process !== child) return
        this.process = null
        this.settleFlow()
        this.flush()
        this.emit('exit', exitCode, signal)
      })
      child.onLink?.((linked) => {
        if (this.process !== child) return
        // The terminal host let it carry on when the link dropped; it still has to wait for the window (ADR 0067).
        if (linked && this.paused) child.pause()
        this.emit('link', linked)
      })
      // A host daemon reports a failed spawn after the fact.
      child.onError((error) => {
        if (this.process !== child) return
        this.process = null
        this.fail(error)
      })
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private fail(failure: Error): void {
    // An 'error' event with no listener would throw out of a timer or an IPC call; say it in the terminal instead.
    if (this.listenerCount('error') > 0) this.emit('error', failure)
    else this.annotate(`\r\n\x1b[31mCould not start: ${failure.message}\x1b[0m\r\n`)
  }

  private append(data: string, replay = false): void {
    const offset = this.buffer.append(data)
    if (replay && this.mirror) {
      // Answers come out while this chunk is parsed, and the callback runs right after it.
      this.replaying++
      this.mirror.write(data, () => this.replaying--)
    } else this.mirror?.write(data)
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
    if (!this.watched) return
    this.unacked += outbox.data.length
    if (this.paused || this.unacked <= FLOW_HIGH || !this.process) return
    this.paused = true
    try {
      this.process.pause()
    } catch {
      // Exiting.
    }
    this.armStall()
  }

  /** The process is gone or let go: nothing waits, and the next one starts with a clean count. */
  private settleFlow(): void {
    if (this.stall) clearTimeout(this.stall)
    this.stall = null
    this.paused = false
    this.unacked = 0
  }
}
