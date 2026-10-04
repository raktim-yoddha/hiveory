import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../../app/logger'
import { HELPER_CSHARP, helperScript } from './helper-source'

const REQUEST_TIMEOUT_MS = 30000
/** The first start compiles the helper (a few seconds); later starts load the cached DLL. */
const START_TIMEOUT_MS = 60000

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Controls the user's desktop through one warm native helper process
 * (Windows). Commands are JSON lines; the helper stays up between calls, so
 * clicks and keystrokes cost milliseconds.
 */
export class ComputerService {
  readonly supported = process.platform === 'win32'
  private child: ChildProcess | null = null
  private ready: Promise<void> | null = null
  private readonly pending = new Map<number, Pending>()
  private seq = 0

  constructor(
    private readonly runtimeDir: string,
    private readonly log: Logger
  ) {}

  /** Starts the helper ahead of the first call, so that call does not pay for the start. */
  warm(): void {
    if (this.supported) void this.start().catch((error) => this.log.warn('Computer helper failed to start', error))
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const dir = join(this.runtimeDir, 'computer')
      mkdirSync(dir, { recursive: true })
      const hash = createHash('sha1').update(HELPER_CSHARP).digest('hex').slice(0, 12)
      const dll = join(dir, `hv-computer-${hash}.dll`)
      const cs = join(dir, `hv-computer-${hash}.cs`)
      const ps1 = join(dir, `hv-computer-${hash}.ps1`)
      if (!existsSync(cs)) writeFileSync(cs, HELPER_CSHARP)
      writeFileSync(ps1, helperScript(dll))
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      this.child = child
      let buffer = ''
      let stderr = ''
      const startTimer = setTimeout(() => {
        reject(new Error('The computer-use helper did not start in time.'))
        child.kill()
      }, START_TIMEOUT_MS)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          let message: { ready?: boolean; id?: number; ok?: boolean; value?: unknown; error?: string }
          try {
            message = JSON.parse(line)
          } catch {
            continue
          }
          if (message.ready) {
            clearTimeout(startTimer)
            resolve()
            continue
          }
          const waiting = typeof message.id === 'number' ? this.pending.get(message.id) : undefined
          if (!waiting) continue
          this.pending.delete(message.id!)
          clearTimeout(waiting.timer)
          if (message.ok) waiting.resolve(message.value)
          else waiting.reject(new Error(message.error ?? 'The computer-use helper failed.'))
        }
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-4000)))
      child.on('exit', (code) => {
        clearTimeout(startTimer)
        this.child = null
        this.ready = null
        const error = new Error(`The computer-use helper stopped (code ${code}). ${stderr.trim().split('\n').slice(-3).join(' ')}`.trim())
        reject(error)
        for (const [id, waiting] of this.pending) {
          clearTimeout(waiting.timer)
          waiting.reject(error)
          this.pending.delete(id)
        }
      })
      child.on('error', (error) => reject(error))
    })
    return this.ready
  }

  async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!this.supported) throw new Error('Computer use is available on Windows for now.')
    await this.start()
    const child = this.child
    if (!child?.stdin) throw new Error('The computer-use helper is not running.')
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Computer action "${op}" timed out.`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      child.stdin!.write(`${JSON.stringify({ id, op, args })}\n`)
    })
  }

  dispose(): void {
    this.child?.kill()
    this.child = null
    this.ready = null
  }
}
