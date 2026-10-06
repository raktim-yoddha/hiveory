import { utilityProcess, type UtilityProcess } from 'electron'
import { HOST_PROTOCOL, type HostFrame, type HostTransport } from '@shared/host/protocol'
import type { Logger } from '../../app/logger'
import { HostClient } from './host-client'

/** After this many failed starts in a row, PTYs stay in-process for the session. */
const MAX_FAILURES = 3
const HELLO_TIMEOUT_MS = 10_000

const utilityTransport = (child: UtilityProcess): HostTransport => ({
  send: (frame) => child.postMessage(frame),
  onFrame: (listener) => void child.on('message', (frame: HostFrame) => listener(frame)),
  onClose: (listener) => void child.once('exit', () => listener()),
  close: () => void child.kill()
})

/**
 * This machine's host daemon (hiveoryd) in its own utility process (ADR 0022):
 * agent and shell PTYs live there, so a crash in native terminal code ends those
 * processes, not Hiveory. It starts on first use and restarts after a crash.
 * If it keeps failing, `get()` answers null and PTYs run in-process instead:
 * terminals never stop working because isolation is unavailable.
 */
export class LocalHost {
  private client: HostClient | null = null
  private starting: Promise<HostClient | null> | null = null
  private failures = 0
  private disposed = false

  constructor(
    private readonly entry: string,
    private readonly log: Logger,
    private readonly notice: (message: string) => void
  ) {}

  get(): Promise<HostClient | null> {
    if (this.client?.alive) return Promise.resolve(this.client)
    if (this.disposed || this.failures >= MAX_FAILURES) return Promise.resolve(null)
    this.starting ??= this.start().finally(() => (this.starting = null))
    return this.starting
  }

  dispose(): void {
    this.disposed = true
    this.client?.close()
    this.client = null
  }

  private async start(): Promise<HostClient | null> {
    let child: UtilityProcess
    try {
      child = utilityProcess.fork(this.entry, [], { serviceName: 'Hiveory host', stdio: 'pipe' })
    } catch (error) {
      return this.failed('could not start', error)
    }
    child.stdout?.on('data', (d: Buffer) => this.log.info(`hiveoryd: ${String(d).trim()}`))
    child.stderr?.on('data', (d: Buffer) => this.log.warn(`hiveoryd: ${String(d).trim()}`))
    const client = new HostClient(utilityTransport(child))
    try {
      const hello = await client.call('hello', { protocol: HOST_PROTOCOL }, HELLO_TIMEOUT_MS)
      if (hello.protocol !== HOST_PROTOCOL) throw new Error(`protocol ${hello.protocol}, expected ${HOST_PROTOCOL}`)
    } catch (error) {
      client.close()
      return this.failed('did not answer', error)
    }
    this.failures = 0
    this.client = client
    client.onClosed(() => {
      if (this.client === client) this.client = null
      if (this.disposed) return
      this.failures++
      this.log.warn('The terminal host stopped; it restarts with the next terminal.')
      this.notice('The terminal host stopped, so its agents and terminals ended. Restart them; Hiveory kept running.')
    })
    this.log.info(`Terminal host started (pid ${child.pid})`)
    return client
  }

  private failed(what: string, error: unknown): null {
    this.failures++
    this.log.error(`Terminal host ${what}`, error)
    if (this.failures >= MAX_FAILURES) this.notice('Terminals now run inside Hiveory: the separate terminal host could not start.')
    return null
  }
}
