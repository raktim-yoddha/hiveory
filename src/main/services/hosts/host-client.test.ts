import { describe, expect, it } from 'vitest'
import type { HostFrame, HostTransport } from '@shared/host/protocol'
import { hostedChatProcesses } from '../chat/chat-process'
import { inProcessPty } from '../pty/pty-backend'
import { HostClient, hostPtyBackend } from './host-client'

/**
 * A host whose frames the test delivers by hand: an answer and the output that follows it arrive
 * in one read, as they do from a socket when Hiveory was busy (starting up, say).
 */
const scripted = () => {
  let listener: (frame: HostFrame) => void = () => undefined
  const sent: HostFrame[] = []
  const transport: HostTransport = { send: (f) => void sent.push(f), onFrame: (l) => void (listener = l), onClose: () => undefined, close: () => undefined }
  const client = new HostClient(transport)
  /** The id of the call the client sent last. */
  const lastCall = (): number => (sent.filter((f) => f.kind === 'call').at(-1) as { id: number }).id
  return { client, sent, lastCall, deliver: (...frames: HostFrame[]) => frames.forEach((f) => listener(f)) }
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))
const procData = (procId: string, data: string): HostFrame => ({ kind: 'event', event: 'proc.data', params: { procId, stream: 'out', data } })
const ptyData = (ptyId: string, data: string): HostFrame => ({ kind: 'event', event: 'pty.data', params: { ptyId, data } })

describe('HostClient: output that arrives with the answer that started it', () => {
  it('a chat turn taken back loses nothing printed between the answer and the bind (ADR 0051)', async () => {
    const host = scripted()
    const proc = hostedChatProcesses(() => Promise.resolve(host.client), () => 'r1').adopt('chat-1')!
    let out = ''
    let ended: number | null | undefined
    proc.onStdout((d) => (out += d))
    proc.onClose((code) => (ended = code))
    await settle()
    host.deliver(
      { kind: 'result', id: host.lastCall(), ok: true, value: { alive: true, out: 'one\ntwo\n', err: '', code: null } },
      procData('r1', 'three\n'),
      procData('r1', 'four\n')
    )
    await settle()
    host.deliver(procData('r1', 'five\n'), { kind: 'event', event: 'proc.exit', params: { procId: 'r1', code: 0 } })
    expect(out).toBe('one\ntwo\nthree\nfour\nfive\n')
    expect(ended).toBe(0)
  })

  it('a chat turn that ends in the same read as its start still reports its output and end', async () => {
    const host = scripted()
    const proc = hostedChatProcesses(() => Promise.resolve(host.client), () => undefined).spawn({ key: 'chat-1', file: 'x', args: [], cwd: '.', env: {} })
    let out = ''
    let ended: number | null | undefined
    proc.onStdout((d) => (out += d))
    proc.onClose((code) => (ended = code))
    await settle()
    host.deliver({ kind: 'result', id: host.lastCall(), ok: true, value: { procId: 'r7', pid: 1 } }, procData('r7', 'done\n'), { kind: 'event', event: 'proc.exit', params: { procId: 'r7', code: 0 } })
    await settle()
    expect(out).toBe('done\n')
    expect(ended).toBe(0)
  })

  it('a terminal taken back shows what it kept, then what it printed since, in order (ADR 0050)', async () => {
    const host = scripted()
    const pty = hostPtyBackend(() => Promise.resolve(host.client), inProcessPty).spawn({ file: 'x', args: [], cwd: '.', env: {}, cols: 80, rows: 24, adopt: 'p1' })
    let out = ''
    pty.onData((d) => (out += d))
    await settle()
    host.deliver({ kind: 'result', id: host.lastCall(), ok: true, value: { alive: true, data: 'kept ' } }, ptyData('p1', 'since '))
    await settle()
    host.deliver(ptyData('p1', 'later'))
    expect(out).toBe('kept since later')
  })

  it("a new terminal's first output is not lost when it comes with the answer to its start", async () => {
    const host = scripted()
    const pty = hostPtyBackend(() => Promise.resolve(host.client), inProcessPty).spawn({ file: 'x', args: [], cwd: '.', env: {}, cols: 80, rows: 24 })
    let out = ''
    pty.onData((d) => (out += d))
    await settle()
    host.deliver({ kind: 'result', id: host.lastCall(), ok: true, value: { ptyId: 'p9', pid: 1 } }, ptyData('p9', 'prompt> '))
    await settle()
    expect(out).toBe('prompt> ')
  })

  it('output for a terminal nobody started here is dropped, not kept', () => {
    const host = scripted()
    host.deliver(ptyData('p-unknown', 'x'))
    let out = ''
    host.client.bind('p-unknown', { data: (d) => (out += d), exit: () => undefined })
    expect(out).toBe('')
  })
})
