import { spawn } from 'node:child_process'
import type { ProcSpawnParams } from '@shared/host/protocol'
import type { HostClient } from '../hosts/host-client'
import { killTree } from '../pty/spawn-target'

/**
 * One chat turn's CLI process, wherever it runs (ADR 0051): in the terminal host, so the turn
 * outlives Hiveory, or here when the host is unavailable. Output arrives as text chunks.
 */
export interface ChatProcess {
  onStdout(listener: (data: string) => void): void
  onStderr(listener: (data: string) => void): void
  /** It ended (`code` null: killed, failed to start, or its host was lost). */
  onClose(listener: (code: number | null, error?: string) => void): void
  kill(): void
  /** Hiveory quits with the turn kept: stop listening, leave the process running. */
  detach(): void
}

export interface ChatProcessBackend {
  spawn(spec: ProcSpawnParams): ChatProcess
  /** The terminal host's run for `key` that outlived the last Hiveory, from its first byte (once). */
  adopt(key: string): ChatProcess | undefined
}

/** A process with listeners that can be told about events before or after they are added. */
class Listeners implements ChatProcess {
  readonly out: Array<(d: string) => void> = []
  readonly err: Array<(d: string) => void> = []
  readonly close: Array<(code: number | null, error?: string) => void> = []
  killer: () => void = () => undefined
  detacher: () => void = () => undefined
  killed = false
  onStdout(l: (d: string) => void): void {
    this.out.push(l)
  }
  onStderr(l: (d: string) => void): void {
    this.err.push(l)
  }
  onClose(l: (code: number | null, error?: string) => void): void {
    this.close.push(l)
  }
  kill(): void {
    this.killed = true
    this.killer()
  }
  detach(): void {
    this.out.length = 0
    this.err.length = 0
    this.close.length = 0
    this.detacher()
  }
  emit(stream: 'out' | 'err', data: string): void {
    for (const l of stream === 'out' ? this.out : this.err) l(data)
  }
  ended(code: number | null, error?: string): void {
    for (const l of this.close) l(code, error)
  }
}

/** A run in this process: it ends with Hiveory. */
const startLocal = (spec: ProcSpawnParams, into = new Listeners()): Listeners => {
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(spec.file, spec.args, { cwd: spec.cwd, env: spec.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    queueMicrotask(() => into.ended(null, error instanceof Error ? error.message : String(error)))
    return into
  }
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (d: string) => into.emit('out', d))
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (d: string) => into.emit('err', d))
  let done = false
  const end = (code: number | null, error?: string): void => {
    if (done) return
    done = true
    into.ended(code, error)
  }
  child.on('error', (error) => end(null, error.message))
  child.on('close', (code) => end(code))
  child.stdin?.on('error', () => undefined)
  child.stdin?.end(spec.stdin ?? '')
  into.killer = () => killTree(child)
  if (into.killed) into.killer()
  return into
}

export const localChatProcesses: ChatProcessBackend = {
  spawn: (spec) => startLocal(spec),
  adopt: () => undefined
}

/**
 * Chat turns in the terminal host (ADR 0051), so a reply keeps streaming after Hiveory quits and is
 * rebuilt whole when it opens again; in this process while the host is unavailable.
 */
export const hostedChatProcesses = (host: () => Promise<HostClient | null>, take: (key: string) => string | undefined): ChatProcessBackend => {
  /** Routes a run on `client` into `into`, which may already have had `delivered` stdout characters. */
  const follow = (client: HostClient, procId: string, into: Listeners, delivered = 0): void => {
    client.bindProc(procId, { data: (stream, d) => into.emit(stream, d), exit: (code) => into.ended(code) }, delivered)
    into.killer = () => void client.call('proc.kill', { procId }).catch(() => undefined)
    into.detacher = () => client.unbindProc(procId)
    if (into.killed) into.killer()
  }
  return {
    spawn: (spec) => {
      const into = new Listeners()
      void host().then(
        (client) => {
          if (!client?.alive) return void startLocal(spec, into)
          client.call('proc.spawn', spec).then(
            ({ procId }) => follow(client, procId, into),
            (error: Error) => into.ended(null, error.message)
          )
        },
        () => void startLocal(spec, into)
      )
      return into
    },
    adopt: (key) => {
      const procId = take(key)
      if (!procId) return undefined
      const into = new Listeners()
      void host().then(async (client) => {
        if (!client?.alive) return into.ended(null, 'The terminal host is not reachable.')
        const result = await client.call('proc.attach', { procId }).catch(() => ({ alive: false, out: '', err: '', code: null }))
        // Everything it printed, from the start: the reply is rebuilt from it.
        if (result.err) into.emit('err', result.err)
        if (result.out) into.emit('out', result.out)
        if (!result.alive) return into.ended(result.code)
        follow(client, procId, into, result.out.length)
      })
      return into
    }
  }
}
