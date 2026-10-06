import { execFile } from 'node:child_process'
import * as pty from '@lydell/node-pty'
import { HOST_PROTOCOL, type ExecParams, type HostCalls, type HostFrame, type HostTransport, type PtySpawnParams } from '@shared/host/protocol'

const MAX_EXEC_OUTPUT = 32 * 1024 * 1024

/**
 * The host daemon's request handling (`hiveoryd`, ADR 0022): it owns the PTYs and
 * processes on its machine and answers over any transport. It keeps no UI state
 * and never reaches back into Hiveory; when the transport closes, its PTYs end.
 */
export const serveHost = (transport: HostTransport): void => {
  const ptys = new Map<string, pty.IPty>()
  let seq = 0
  const event = (name: 'pty.data' | 'pty.exit', params: unknown): void => transport.send({ kind: 'event', event: name, params })

  const spawn = (p: PtySpawnParams): HostCalls['pty.spawn']['result'] => {
    const child = pty.spawn(p.file, p.args, {
      name: 'xterm-256color',
      cols: p.cols,
      rows: p.rows,
      cwd: p.cwd,
      env: p.env,
      // Bundled modern ConPTY renders far more faithfully than the inbox Windows one.
      ...(process.platform === 'win32' ? { useConptyDll: true } : {})
    })
    const ptyId = `p${++seq}`
    ptys.set(ptyId, child)
    child.onData((data) => event('pty.data', { ptyId, data }))
    child.onExit(({ exitCode, signal }) => {
      ptys.delete(ptyId)
      event('pty.exit', { ptyId, code: exitCode, signal: signal ?? null })
    })
    return { ptyId, pid: child.pid }
  }

  const exec = (p: ExecParams): Promise<HostCalls['exec']['result']> =>
    new Promise((resolve) => {
      execFile(
        p.file,
        p.args,
        { cwd: p.cwd, env: p.env, timeout: p.timeoutMs, windowsHide: true, maxBuffer: MAX_EXEC_OUTPUT },
        (error, stdout, stderr) => {
          const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : null) : 0
          resolve({ code, stdout: String(stdout), stderr: String(stderr || (error && code === null ? error.message : '')) })
        }
      )
    })

  const call = async (method: string, params: unknown): Promise<unknown> => {
    switch (method) {
      case 'hello':
        return { protocol: HOST_PROTOCOL, pid: process.pid, platform: process.platform }
      case 'pty.spawn':
        return spawn(params as PtySpawnParams)
      case 'pty.kill': {
        const { ptyId } = params as { ptyId: string }
        try {
          ptys.get(ptyId)?.kill()
        } catch {
          // Already gone.
        }
        return null
      }
      case 'exec':
        return exec(params as ExecParams)
      default:
        throw new Error(`Unknown host call: ${method}`)
    }
  }

  transport.onFrame((frame: HostFrame) => {
    if (frame.kind === 'call') {
      call(frame.method, frame.params).then(
        (value) => transport.send({ kind: 'result', id: frame.id, ok: true, value }),
        (error: unknown) => transport.send({ kind: 'result', id: frame.id, ok: false, error: error instanceof Error ? error.message : String(error) })
      )
    } else if (frame.kind === 'notify') {
      const p = frame.params as { ptyId: string; data?: string; cols?: number; rows?: number }
      const child = ptys.get(p.ptyId)
      try {
        if (frame.method === 'pty.write' && p.data !== undefined) child?.write(p.data)
        else if (frame.method === 'pty.resize' && p.cols && p.rows) child?.resize(p.cols, p.rows)
      } catch {
        // A PTY that is exiting can refuse a write or resize; never fatal.
      }
    }
  })

  transport.onClose(() => {
    for (const child of ptys.values()) {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    }
    ptys.clear()
  })
}
