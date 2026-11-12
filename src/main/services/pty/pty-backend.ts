import * as pty from '@lydell/node-pty'
import type { PtySpawnParams } from '@shared/host/protocol'

/** One pseudo-terminal process, wherever it runs (in main, in the local host daemon, on a remote host). */
export interface PtyHandle {
  /** Output; `replay`: printed earlier, handed over when the terminal is taken back (ADR 0050). */
  onData(listener: (data: string, replay?: boolean) => void): void
  onExit(listener: (exit: { exitCode: number | null; signal: number | null }) => void): void
  /** A spawn that fails after `spawn` returned (a host daemon reports it asynchronously). */
  onError(listener: (error: Error) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  /** Flow control (ADR 0067): stop reading its output, so the program waits; and carry on. */
  pause(): void
  resume(): void
  /** A host daemon's terminal: false while the link to it is down (the process may still run), true again once back. */
  onLink?(listener: (linked: boolean) => void): void
}

/** What a backend starts: a new process, or with `adopt` a daemon's kept terminal by its id (ADR 0050). */
export type PtyStart = PtySpawnParams & { adopt?: string }

/** Where PtySession starts its processes (ADR 0022). `spawn` may throw for a synchronous failure. */
export interface PtyBackend {
  spawn(spec: PtyStart): PtyHandle
}

/** node-pty inside the current process: the fallback when no host daemon is available, and the test default. */
export const inProcessPty: PtyBackend = {
  spawn: (spec) => {
    const child = pty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: spec.env,
      // Bundled modern ConPTY renders far more faithfully than the inbox Windows one.
      ...(process.platform === 'win32' ? { useConptyDll: true } : {})
    })
    return {
      onData: (l) => void child.onData(l),
      onExit: (l) => void child.onExit(({ exitCode, signal }) => l({ exitCode, signal: signal ?? null })),
      onError: () => undefined,
      write: (data) => child.write(data),
      resize: (cols, rows) => child.resize(cols, rows),
      kill: () => child.kill(),
      pause: () => child.pause(),
      resume: () => child.resume()
    }
  }
}
