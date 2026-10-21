import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HOST_PROTOCOL, transportPair, type HostTransport } from '@shared/host/protocol'
import { publish } from '../../../host/endpoint-owner'
import { createRelay } from '../../../host/relay'
import { createHostState, disposeHostState, gateHost, type HostState } from '../../../host/host-server'
import { HookServer } from '../cli/hooks/hook-server'
import { CliRuntimeManager } from '../cli/runtime/runtime-manager'
import type { CliRegistry } from '../cli/registry'
import { ShellService } from '../shell/shell-service'
import type { PtyBackend, PtyHandle, PtyStart } from '../pty/pty-backend'
import { newNonce, newToken, prove, verifyProof } from './handshake'
import { HostClient, hostPtyBackend } from './host-client'
import { localEndpointPath } from './local-endpoint'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const states: HostState[] = []
afterEach(() => {
  for (const s of states.splice(0)) disposeHostState(s)
})

/** A client of a token-protected daemon state, authenticated like LocalHost does (or not, with `token` wrong). */
const connect = async (state: HostState, token: string, clientToken = token): Promise<{ client: HostClient; transport: HostTransport }> => {
  const [clientSide, hostSide] = transportPair()
  gateHost(state, hostSide, token)
  const client = new HostClient(clientSide, { keepPtys: true })
  const nonce = newNonce()
  const hello = await client.call('hello', { protocol: HOST_PROTOCOL, nonce })
  expect(verifyProof(token, 'daemon', nonce, hello.proof)).toBe(true)
  await client.call('auth', { proof: prove(clientToken, 'client', hello.nonce!) })
  return { client, transport: clientSide }
}

const until = async (check: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** A process that prints `first`, then `later` after a pause, then stays alive. */
const talker = (cwd: string) => ({
  file: process.execPath,
  args: ['-e', "console.log('first'); setTimeout(() => console.log('later'), 700); setInterval(() => {}, 1000)"],
  cwd,
  env: { ...process.env } as Record<string, string>,
  cols: 80,
  rows: 24
})

describe('mutual hello (ADR 0050 §2)', () => {
  it('each side proves the token without revealing it', () => {
    const token = newToken()
    const nonce = newNonce()
    const proof = prove(token, 'daemon', nonce)
    expect(proof).not.toContain(token)
    expect(verifyProof(token, 'daemon', nonce, proof)).toBe(true)
    expect(verifyProof(token, 'client', nonce, proof)).toBe(false)
    expect(verifyProof(newToken(), 'daemon', nonce, proof)).toBe(false)
    expect(verifyProof(token, 'daemon', nonce, 42)).toBe(false)
  })

  it('serves nothing before auth, and drops a client with the wrong token', async () => {
    const state = createHostState()
    states.push(state)
    const token = newToken()
    const [early, hostSide] = transportPair()
    gateHost(state, hostSide, token)
    await expect(new HostClient(early).call('pty.list', null)).rejects.toThrow()
    await expect(connect(state, token, newToken())).rejects.toThrow()
    expect(state.out).toBeNull()
    const { client } = await connect(state, token)
    await expect(client.call('pty.list', null)).resolves.toEqual([])
  })
})

describe('terminals outlive the app (ADR 0050 §4–5)', () => {
  it('a keyed terminal keeps running and printing after its client leaves, and the next one takes it back', async () => {
    const state = createHostState()
    states.push(state)
    const token = newToken()
    const cwd = mkdtempSync(join(tmpdir(), 'hv-daemon-'))
    const first = await connect(state, token)
    const { ptyId } = await first.client.call('pty.spawn', { ...talker(cwd), key: 'agent-1' })
    const seen: string[] = []
    first.client.bind(ptyId, { data: (d) => seen.push(d), exit: () => undefined })
    await until(() => seen.join('').includes('first'))
    first.client.close()

    // The next app: it finds the terminal by key and attaches; what it printed meanwhile comes too.
    await new Promise((r) => setTimeout(r, 1200))
    const second = await connect(state, token)
    const list = await second.client.call('pty.list', null)
    expect(list).toEqual([expect.objectContaining({ key: 'agent-1', ptyId, alive: true })])
    const backend = hostPtyBackend(() => Promise.resolve(second.client), { spawn: () => { throw new Error('must not start a new process') } })
    const handle = backend.spawn({ ...talker(cwd), key: 'agent-1', adopt: ptyId })
    const after: string[] = []
    handle.onData((d) => after.push(d))
    await until(() => after.join('').includes('later'))
    expect(after.join('')).not.toContain('first')
    // Ended before the state is disposed: ConPTY must not be killed twice.
    const exited = new Promise((r) => handle.onExit(r))
    handle.kill()
    await exited
  }, 20_000)

  it('a terminal that ended while no app was attached is listed with how it ended', async () => {
    const state = createHostState()
    states.push(state)
    const token = newToken()
    const first = await connect(state, token)
    const { ptyId } = await first.client.call('pty.spawn', {
      ...talker(tmpdir()),
      args: ['-e', 'setTimeout(() => process.exit(3), 200)'],
      key: 'agent-2'
    })
    first.client.close()
    await until(() => state.ended.size > 0, 10_000)
    const second = await connect(state, token)
    expect(await second.client.call('pty.list', null)).toEqual([expect.objectContaining({ ptyId, key: 'agent-2', alive: false, exit: { code: 3, signal: null } })])
  }, 20_000)

  it('shutdown ends every terminal', async () => {
    let shut = false
    const state = createHostState({ onShutdown: () => (shut = true) })
    states.push(state)
    const token = newToken()
    const { client } = await connect(state, token)
    await client.call('pty.spawn', { ...talker(tmpdir()), key: 'agent-3' })
    await client.call('shutdown', null)
    await until(() => shut)
    expect(state.terminals.size).toBe(0)
  }, 20_000)
})

describe('endpoint ownership (ADR 0050 §3)', () => {
  it('a second daemon never takes a live endpoint; a dead one is replaced', async () => {
    const path = localEndpointPath(mkdtempSync(join(tmpdir(), 'hv-ep-')), HOST_PROTOCOL)
    const owner = createServer()
    expect(await publish(owner, path)).toBe(true)
    const rival = createServer()
    expect(await publish(rival, path)).toBe(false)
    expect(rival.listening).toBe(false)
    await new Promise<void>((r) => owner.close(() => r()))
    const next = createServer()
    expect(await publish(next, path)).toBe(true)
    await new Promise<void>((r) => next.close(() => r()))
  })

  it('names pipes per profile and protocol', () => {
    expect(localEndpointPath('C:\\Users\\me\\AppData\\Local\\Hiveory\\Runtime\\hiveoryd', 3, 'win32')).toMatch(/^\\\\\.\\pipe\\hiveoryd-[0-9a-f]{16}-3$/)
    expect(localEndpointPath('C:\\a', 3, 'win32')).not.toBe(localEndpointPath('C:\\b', 3, 'win32'))
    expect(localEndpointPath('/home/me/.local/share/hiveory/Runtime/hiveoryd', 3, 'linux')).toBe('/home/me/.local/share/hiveory/Runtime/hiveoryd/hiveoryd-3.sock')
  })
})

describe('hook endpoint survives restarts (ADR 0050 §6)', () => {
  it('keeps its port and token in the profile', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hv-hook-')), 'hook-endpoint.json')
    const a = new HookServer(() => undefined, log, file)
    await a.start()
    const before = a.endpoint
    a.stop()
    const b = new HookServer(() => undefined, log, file)
    await b.start()
    expect(b.endpoint).toEqual(before)
    b.stop()
  })
})

/** A backend that records what it was asked to start, with a handle whose link can be dropped. */
const recordingBackend = () => {
  const starts: PtyStart[] = []
  const links: Array<(linked: boolean) => void> = []
  const backend: PtyBackend = {
    spawn: (spec) => {
      starts.push(spec)
      const handle: PtyHandle = {
        onData: () => undefined,
        onExit: () => undefined,
        onError: () => undefined,
        onLink: (l) => void links.push(l),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined
      }
      return handle
    }
  }
  return { backend, starts, links }
}

describe('agents and shells take their kept terminals back', () => {
  it('a shell attaches to its kept terminal once, then starts anew', () => {
    const { backend, starts } = recordingBackend()
    const kept = new Map([['shell-a', 'p7']])
    const shells = new ShellService(backend, (id) => {
      const ptyId = kept.get(id)
      kept.delete(id)
      return ptyId
    })
    const { id } = shells.open('a', tmpdir())
    shells.resize(id, 100, 30)
    expect(starts[0]).toMatchObject({ key: 'shell-a', adopt: 'p7' })
    shells.restart(id)
    expect(starts[1]).toMatchObject({ key: 'shell-a' })
    expect(starts[1]!.adopt).toBeUndefined()
    shells.detachAll()
  })

  it('an agent attaches by its id, and an unreachable terminal says so without ending', () => {
    const { backend, starts, links } = recordingBackend()
    const adapter = { id: 'x', displayName: 'X', supportsAutoApprove: false, buildLaunch: () => ({ args: [] }), heuristics: () => null }
    const registry = { adapter: () => adapter, executable: () => process.execPath, displayName: () => 'X' } as unknown as CliRegistry
    const runtime = new CliRuntimeManager(registry, log, mkdtempSync(join(tmpdir(), 'hv-rt-')), () => undefined, () => undefined, backend, (id) =>
      id === 'agent-9' ? { ptyId: 'p3', hooks: [] } : undefined
    )
    const instance = { id: 'agent-9', projectId: 'p', workspaceId: 'w', cliId: 'x', petName: 'Milo', conversationId: 'c', hasConversation: true, autoApprove: false, createdAt: '' }
    runtime.launch(instance, tmpdir())
    runtime.resize('agent-9', 100, 30)
    expect(starts[0]).toMatchObject({ key: 'agent-9', adopt: 'p3' })
    links[0]!(false)
    expect(runtime.details('agent-9')).toMatchObject({ running: true, activity: 'Reconnecting to its terminal…' })
    links[0]!(true)
    expect(runtime.details('agent-9').activity).toBeUndefined()
    runtime.detachAll()
  })
})

describe('the relay: hooks and tools outlive the app (ADR 0050 §6)', () => {
  const post = (url: string, token: string, body: unknown, bearer = false) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${token}` } : { 'X-Hiveory-Token': token }) },
      body: JSON.stringify(body)
    })

  it('keeps hooks while no app is attached and forwards them once one is', async () => {
    const [appSide, daemonSide] = transportPair()
    let attached: HostTransport | null = null
    const relay = createRelay(() => attached, join(mkdtempSync(join(tmpdir(), 'hv-relay-')), 'relay.json'), log)
    await relay.server.start()
    const { baseUrl, token } = relay.server.endpoint!
    expect((await post(`${baseUrl}/hooks/agent-1/PermissionRequest`, token, { tool_name: 'Bash' })).status).toBe(204)
    expect((await post(`${baseUrl}/hooks/agent-1/Stop`, 'wrong', {})).status).toBe(403)
    expect(relay.calls['relay.kept']()).toEqual([expect.objectContaining({ instanceId: 'agent-1', event: 'PermissionRequest', payload: { tool_name: 'Bash' } })])
    expect(relay.calls['relay.kept']()).toEqual([])

    attached = daemonSide
    const events: unknown[] = []
    appSide.onFrame((f) => events.push(f))
    await post(`${baseUrl}/hooks/agent-1/Stop`, token, {})
    await until(() => events.length > 0)
    expect(events[0]).toMatchObject({ kind: 'event', event: 'relay.hook', params: { instanceId: 'agent-1', event: 'Stop' } })
    relay.server.stop()
  })

  it('answers tool calls through the app, and says Hiveory is not open without one', async () => {
    const [appSide, daemonSide] = transportPair()
    let attached: HostTransport | null = null
    const relay = createRelay(() => attached, join(mkdtempSync(join(tmpdir(), 'hv-relay-')), 'relay.json'), log)
    await relay.server.start()
    const { baseUrl, token } = relay.server.endpoint!
    const closed = await (await post(`${baseUrl}/mcp/agent-1`, token, { jsonrpc: '2.0', id: 7, method: 'tools/list' }, true)).json()
    expect(closed).toMatchObject({ id: 7, error: { message: expect.stringContaining('not open') } })

    attached = daemonSide
    appSide.onFrame((f) => {
      if (f.kind !== 'event' || f.event !== 'relay.mcp') return
      const { requestId } = f.params as { requestId: string }
      relay.notifications['relay.reply']({ requestId, body: { jsonrpc: '2.0', id: 8, result: { tools: [] } } })
    })
    const open = await (await post(`${baseUrl}/mcp/agent-1`, token, { jsonrpc: '2.0', id: 8, method: 'tools/list' }, true)).json()
    expect(open).toEqual({ jsonrpc: '2.0', id: 8, result: { tools: [] } })
    relay.server.stop()
  })

  it('a taken-back agent shows the status it had, then what its kept hooks say', () => {
    const { backend } = recordingBackend()
    const adapter = {
      id: 'x',
      displayName: 'X',
      supportsAutoApprove: false,
      buildLaunch: () => ({ args: [] }),
      heuristics: () => null,
      mapHookEvent: (event: string) => (event === 'PermissionRequest' ? ({ type: 'needs-user', reason: 'permission' } as const) : null)
    }
    const registry = { adapter: () => adapter, executable: () => process.execPath, displayName: () => 'X' } as unknown as CliRegistry
    const root = mkdtempSync(join(tmpdir(), 'hv-rt-'))
    const instance = { id: 'agent-5', projectId: 'p', workspaceId: 'w', cliId: 'x', petName: 'Kai', conversationId: 'c', hasConversation: true, autoApprove: false, createdAt: '' }
    // First run: working when Hiveory quits with agents kept.
    const before = new CliRuntimeManager(registry, log, root, () => undefined, () => undefined, backend)
    before.launch(instance, tmpdir())
    ;(before as unknown as { sessions: Map<string, { details: object }> }).sessions.get('agent-5')!.details = { status: 'working', running: true, activity: 'Using Bash' }
    before.detachAll()
    // Next run: the same status, then the permission prompt its CLI reported meanwhile.
    const after = new CliRuntimeManager(registry, log, root, () => undefined, () => undefined, backend, () => ({
      ptyId: 'p1',
      hooks: [{ instanceId: 'agent-5', event: 'PermissionRequest', payload: {}, at: 1 }]
    }))
    const seen: string[] = []
    after.on('changed', (_i, d) => seen.push(d.status))
    after.launch(instance, tmpdir())
    expect(seen).toContain('working')
    expect(after.details('agent-5')).toMatchObject({ status: 'waiting-for-you', waitingReason: 'permission', running: true })
    after.detachAll()
  })
})
