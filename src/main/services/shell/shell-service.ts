import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { fail } from '@shared/errors'
import { sanitizeEnv } from '../pty/env'
import { PtySession } from '../pty/pty-session'
import { inProcessPty, type PtyBackend } from '../pty/pty-backend'

export interface ShellServiceEvents {
  data: [id: string, data: string, offset: number]
}

/**
 * Side-panel terminals are narrow, and workspace folders live deep in app data;
 * a prompt showing only the folder name keeps commands on one line (the full
 * path is in the panel header). Single quotes only: the line passes through a
 * Windows command line unchanged.
 */
const COMPACT_POWERSHELL = ['-NoLogo', '-NoExit', '-Command', "function prompt { 'PS ' + (Split-Path -Leaf $PWD) + '> ' }"]

/** The user's interactive shell for this platform. */
export const defaultShell = (env: NodeJS.ProcessEnv = process.env): { file: string; args: string[] } => {
  if (process.platform === 'win32') {
    // Prefer PowerShell 7, then Windows PowerShell; both ship a usable interactive prompt.
    const pwsh = (env.ProgramFiles ?? 'C:\\Program Files') + '\\PowerShell\\7\\pwsh.exe'
    if (existsSync(pwsh)) return { file: pwsh, args: COMPACT_POWERSHELL }
    return { file: 'powershell.exe', args: COMPACT_POWERSHELL }
  }
  return { file: env.SHELL || '/bin/bash', args: ['-l'] }
}

/**
 * Plain shell terminals for the right sidebar: any number per Workspace (or
 * project folder), one per side-panel tab. Not agents: they never appear on
 * the Kanban or count as instances.
 */
export class ShellService extends EventEmitter<ShellServiceEvents> {
  private readonly shells = new Map<string, { pty: PtySession; cwd: string }>()

  /** `ptyBackend`: where shell PTYs run — the local host daemon in the app (ADR 0022). */
  constructor(private readonly ptyBackend: PtyBackend = inProcessPty) {
    super()
  }

  /** Ensures a shell exists for `key` in `cwd` and returns its terminal id. */
  open(key: string, cwd: string): { id: string; cwd: string } {
    const id = `shell-${key}`
    const existing = this.shells.get(id)
    if (existing?.pty.running) return { id, cwd: existing.cwd }
    if (!existsSync(cwd)) fail('NOT_FOUND', 'That folder no longer exists.')
    const pty = existing?.pty ?? this.createPty(id)
    this.shells.set(id, { pty, cwd })
    this.spawn(pty, cwd)
    return { id, cwd }
  }

  restart(id: string): void {
    const shell = this.shells.get(id)
    if (!shell) fail('NOT_FOUND', 'Terminal not found.')
    shell!.pty.annotate('\r\n\x1b[2m── terminal restarted ──\x1b[0m\r\n')
    this.spawn(shell!.pty, shell!.cwd)
  }

  close(id: string): void {
    const shell = this.shells.get(id)
    shell?.pty.stop()
    shell?.pty.removeAllListeners()
    this.shells.delete(id)
  }

  has(id: string): boolean {
    return this.shells.has(id)
  }

  isRunning(id: string): boolean {
    return Boolean(this.shells.get(id)?.pty.running)
  }

  write(id: string, data: string): void {
    this.shells.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.shells.get(id)?.pty.resize(cols, rows)
  }

  snapshot(id: string): { data: string; end: number; cols?: number; rows?: number } {
    return this.shells.get(id)?.pty.snapshot() ?? { data: '', end: 0 }
  }

  screenText(id: string, lines: number): string {
    return this.shells.get(id)?.pty.screenText(lines) ?? ''
  }

  disposeAll(): void {
    for (const shell of this.shells.values()) shell.pty.killNow()
    this.shells.clear()
  }

  private createPty(id: string): PtySession {
    const pty = new PtySession(true, this.ptyBackend)
    pty.on('data', (data, offset) => this.emit('data', id, data, offset))
    pty.on('exit', () => pty.annotate('\r\n\x1b[2m── process exited ──\x1b[0m\r\n'))
    return pty
  }

  private spawn(pty: PtySession, cwd: string): void {
    const shell = defaultShell()
    pty.start({ file: shell.file, args: shell.args, cwd, env: sanitizeEnv(process.env) })
  }
}
