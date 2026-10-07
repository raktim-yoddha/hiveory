import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { transportPair } from '@shared/host/protocol'
import { attachHost, createHostState, disposeHostState } from '../../../host/host-server'
import { inProcessPty } from '../pty/pty-backend'
import { HostClient, hostPtyBackend } from './host-client'
import { parseLsofListen, parseProcNetTcp } from './ports'
import { HostRegistry } from './host-kit'
import type { SshHostConnector } from './ssh-host'

const quietLog = { info: () => undefined, warn: () => undefined, error: () => undefined }
const localKitSource = {}

const env = { ...process.env } as Record<string, string>
const node = (code: string) => ({ file: process.execPath, args: ['-e', code], cwd: tmpdir(), env, cols: 80, rows: 20 })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Waits until `ok` holds (terminals start at their own pace, ConPTY slowest). */
const until = async (ok: () => boolean, ms = 10_000) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await sleep(50)
}

/** A remote daemon's state with one client attached over an in-memory link. */
const link = (state: ReturnType<typeof createHostState>) => {
  const [clientSide, hostSide] = transportPair()
  attachHost(state, hostSide, true)
  return { client: new HostClient(clientSide, { keepPtys: true }), drop: () => clientSide.close() }
}

describe('remote terminals outlive a dropped link (ADR 0025)', () => {
  it('keeps running while detached, and the next link gets the output it missed', async () => {
    const state = createHostState({ trash: async () => undefined })
    const first = link(state)
    const pty = hostPtyBackend(() => Promise.resolve(first.client), inProcessPty).spawn(
      node("console.log('before'); setTimeout(() => console.log('while-away'), 2000); process.stdin.on('data', (d) => console.log('got:' + d.toString().trim()))")
    )
    let text = ''
    let exited = false
    pty.onData((d) => (text += d))
    pty.onExit(() => (exited = true))
    await until(() => text.includes('before'))
    expect(text).toContain('before')
    first.drop()
    await sleep(3000)
    expect(exited).toBe(false)
    expect(text).not.toContain('while-away')
    const second = link(state)
    await second.client.adopt(first.client)
    expect(text).toContain('while-away')
    // Keystrokes now go through the new link.
    pty.write('hello\r')
    await sleep(500)
    expect(text).toContain('got:hello')
    pty.kill()
    await sleep(300)
    expect(exited).toBe(true)
    disposeHostState(state)
  }, 20_000)

  it('a terminal that ended while detached reports its exit on adopt', async () => {
    const state = createHostState({ trash: async () => undefined })
    const first = link(state)
    const pty = hostPtyBackend(() => Promise.resolve(first.client), inProcessPty).spawn(node('setTimeout(() => process.exit(7), 1500)'))
    const exit = new Promise<number | null>((resolve) => pty.onExit((e) => resolve(e.exitCode)))
    await sleep(300)
    first.drop()
    await sleep(3000)
    const second = link(state)
    await second.client.adopt(first.client)
    expect(await exit).toBe(7)
    disposeHostState(state)
  }, 20_000)

  it('a local host (no keep) still ends its terminals with the link', async () => {
    const state = createHostState({ trash: async () => undefined })
    const [clientSide, hostSide] = transportPair()
    attachHost(state, hostSide, false)
    const client = new HostClient(clientSide)
    const pty = hostPtyBackend(() => Promise.resolve(client), inProcessPty).spawn(node('setTimeout(() => {}, 30000)'))
    const exit = new Promise((resolve) => pty.onExit(resolve))
    await sleep(300)
    clientSide.close()
    await exit
    expect(state.terminals.size).toBe(0)
  }, 20_000)
})

describe('remote ports', () => {
  it('reads listening sockets from /proc/net/tcp and tcp6', () => {
    const tcp = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1',
      '   1: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2',
      '   2: 0100007F:0BB8 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 3',
      '   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 4',
      '   1: 00000000000000000000000001000000:15B3 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 5'
    ].join('\n')
    expect(parseProcNetTcp(tcp)).toEqual([
      { port: 3000, address: '127.0.0.1' },
      { port: 22, address: '0.0.0.0' },
      { port: 8080, address: '::' },
      { port: 5555, address: '::1' }
    ])
  })

  it('reads lsof output on macOS', () => {
    expect(parseLsofListen('p123\nn*:3000\np456\nn127.0.0.1:5432\nn[::1]:5432\n')).toEqual([
      { port: 3000, address: '*' },
      { port: 5432, address: '127.0.0.1' }
    ])
  })
})

describe('host registry reconnects (ADR 0025)', () => {
  it('reconnects a dropped host, keeps its kit, and moves its terminals to the new link', async () => {
    const state = createHostState({ trash: async () => undefined })
    const links: Array<() => void> = []
    const fakeSsh = {
      deploy: async () => ({ info: {}, installed: false, nodeInstalled: false }),
      connect: async () => {
        const made = link(state)
        links.push(made.drop)
        return { client: made.client, home: tmpdir(), platform: process.platform, remotePort: 4100 }
      }
    } as unknown as SshHostConnector
    const statuses: string[] = []
    const registry = new HostRegistry(localKitSource as never, fakeSsh, [], quietLog, () => undefined, () => undefined, (_host, status) => statuses.push(status))
    const host = { kind: 'ssh' as const, destination: 'box' }
    const kit = await registry.kit(host)
    const pty = kit.pty.spawn(node("process.stdin.on('data', (d) => console.log('echo:' + d.toString().trim()))"))
    let text = ''
    pty.onData((d) => (text += d))
    await sleep(300)
    links[0]!()
    await until(() => statuses.at(-1) === 'connected' && statuses.includes('reconnecting'))
    expect(statuses).toEqual(['connecting', 'connected', 'reconnecting', 'connected'])
    expect(await registry.kit(host)).toBe(kit)
    expect(registry.connected(host)).toBe(true)
    pty.write('after\r')
    await until(() => text.includes('echo:after'))
    expect(text).toContain('echo:after')
    registry.closeAll()
    disposeHostState(state)
  }, 30_000)
})
