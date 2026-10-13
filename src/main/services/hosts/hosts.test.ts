import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { HOST_PROTOCOL, transportPair } from '@shared/host/protocol'
import { serveHost } from '../../../host/host-server'
import { inProcessPty, type PtyBackend } from '../pty/pty-backend'
import { PtySession } from '../pty/pty-session'
import { HostClient, hostPtyBackend } from './host-client'

const env = { ...process.env } as Record<string, string>
const echo = process.platform === 'win32' ? { file: 'cmd.exe', args: ['/d', '/c', 'echo hosted-ok'] } : { file: '/bin/echo', args: ['hosted-ok'] }
/** A shell that stays open until it is killed. */
const waiting = process.platform === 'win32' ? { file: 'cmd.exe', args: ['/d', '/k'] } : { file: '/bin/sh', args: ['-c', 'sleep 30'] }

const connect = () => {
  const [clientSide, hostSide] = transportPair()
  serveHost(hostSide)
  return new HostClient(clientSide)
}

const runEcho = async (backend: PtyBackend) => {
  const pty = new PtySession(true, backend)
  const output: string[] = []
  pty.on('data', (d) => output.push(d))
  const exited = new Promise<number | null>((resolve) => pty.on('exit', (code) => resolve(code)))
  pty.start({ ...echo, cwd: tmpdir(), env })
  pty.resize(80, 20)
  const code = await exited
  await new Promise((r) => setTimeout(r, 50))
  return { code, text: output.join(''), screen: pty.screenText(20) }
}

describe('execution host (hiveoryd protocol)', () => {
  it('greets with its protocol version', async () => {
    const client = connect()
    expect(await client.call('hello', { protocol: HOST_PROTOCOL })).toMatchObject({ protocol: HOST_PROTOCOL, platform: process.platform })
  })

  it('runs a PTY on the host: output, screen mirror and exit code reach the session', async () => {
    const client = connect()
    const result = await runEcho(hostPtyBackend(() => Promise.resolve(client), inProcessPty))
    expect(result.code).toBe(0)
    expect(result.text).toContain('hosted-ok')
    expect(result.screen).toContain('hosted-ok')
  }, 20_000)

  it('runs programs without a shell and reports their exit code', async () => {
    const client = connect()
    const ok = await client.call('exec', { file: process.execPath, args: ['-e', 'process.stdout.write("hi"); process.exit(3)'] })
    expect(ok).toEqual({ code: 3, stdout: 'hi', stderr: '' })
    const missing = await client.call('exec', { file: 'definitely-not-a-program-hv', args: [] })
    expect(missing.code).toBeNull()
  })

  it('ends its sessions when the host goes away, and fails pending calls instead of hanging', async () => {
    const [clientSide, hostSide] = transportPair()
    serveHost(hostSide)
    const client = new HostClient(clientSide)
    const pty = new PtySession(false, hostPtyBackend(() => Promise.resolve(client), inProcessPty))
    const exited = new Promise<number | null>((resolve) => pty.on('exit', (code) => resolve(code)))
    pty.start({ ...waiting, cwd: tmpdir(), env })
    pty.resize(80, 20)
    await new Promise((r) => setTimeout(r, 300))
    clientSide.close()
    expect(await exited).toBeNull()
    await expect(client.call('hello', { protocol: HOST_PROTOCOL })).rejects.toThrow('not connected')
  }, 20_000)

  it('falls back to an in-process PTY when no host is available', async () => {
    const result = await runEcho(hostPtyBackend(() => Promise.resolve(null), inProcessPty))
    expect(result.code).toBe(0)
    expect(result.text).toContain('hosted-ok')
  }, 20_000)

  // Windows (ConPTY) refuses a missing program at spawn; macOS and Linux fork first, so the program
  // "starts" and exits at once with a failure code. Either way the session ends with nothing running.
  it('reports a program the host cannot start: a session error on Windows, a failed exit elsewhere', async () => {
    const client = connect()
    const pty = new PtySession(false, hostPtyBackend(() => Promise.resolve(client), inProcessPty))
    const ended = new Promise<{ error?: string; code?: number | null }>((resolve) => {
      pty.on('error', (e) => resolve({ error: e.message }))
      pty.on('exit', (code) => resolve({ code }))
    })
    pty.start({ file: 'definitely-not-a-program-hv', args: [], cwd: tmpdir(), env })
    pty.resize(80, 20)
    const result = await ended
    if (process.platform === 'win32') expect(result.error).toBeTruthy()
    else expect(result.code).not.toBe(0)
    expect(pty.hasProcess).toBe(false)
  }, 20_000)
})
