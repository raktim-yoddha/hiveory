import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { HostFrame } from '@shared/host/protocol'
import { explainSshFailure, isSafeDestination, lineTransport, NODE_PTY_VERSION, parseProbe, SshHostConnector } from './ssh-host'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }

const fakeChild = () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => child.emit('close', null) })
  return child as unknown as ChildProcessWithoutNullStreams & EventEmitter
}

describe('SSH hosts', () => {
  it('only passes plain destinations to ssh, never options or shell syntax', () => {
    for (const ok of ['devbox', 'me@box.example.com', 'build_01', 'me@10.0.0.4']) expect(isSafeDestination(ok)).toBe(true)
    for (const bad of ['-oProxyCommand=evil', 'box;rm -rf ~', 'a b', '', '$(id)', 'me@-x', '@host']) expect(isSafeDestination(bad)).toBe(false)
  })

  it('refuses an unsafe destination before running anything', async () => {
    let spawned = false
    const connector = new SshHostConnector('unused', log, [], () => {
      spawned = true
      return fakeChild()
    })
    await expect(connector.probe({ destination: '-oProxyCommand=x' })).rejects.toMatchObject({ error: { code: 'INVALID_INPUT' } })
    expect(spawned).toBe(false)
  })

  it('reads the probe', () => {
    expect(parseProbe('Linux\nx86_64\n/home/dev\nv22.11.0\n')).toEqual({ platform: 'linux', arch: 'x86_64', home: '/home/dev', node: '22.11.0' })
    expect(parseProbe('Darwin\narm64\n/Users/me\nnone\n').node).toBe('')
  })

  it('explains ssh failures with a next step', () => {
    const code = (stderr: string) => {
      try {
        explainSshFailure('box', stderr)
      } catch (e) {
        return (e as { error: { code: string; hint?: string } }).error
      }
    }
    expect(code('Host key verification failed.')).toMatchObject({ code: 'FORBIDDEN', hint: expect.stringContaining('never accepts host keys') })
    expect(code('dev@box: Permission denied (publickey).')).toMatchObject({ code: 'FORBIDDEN', hint: expect.stringContaining('never asks for passwords') })
    expect(code('ssh: connect to host box port 22: Connection refused')).toMatchObject({ code: 'NOT_FOUND' })
    expect(code('weird')).toMatchObject({ code: 'UNEXPECTED' })
  })

  it('frames one JSON message per line, across chunk boundaries, ignoring banner noise', async () => {
    const child = fakeChild()
    const transport = lineTransport(child, log)
    const got: HostFrame[] = []
    transport.onFrame((f) => got.push(f))
    const out = child.stdout as unknown as PassThrough
    out.write('Welcome to the box\n{"kind":"event","event":"pty.data",')
    out.write('"params":{"ptyId":"p1","data":"hi"}}\n{"kind":"result","id":1,"ok":true,"value":null}\n')
    await new Promise((r) => setImmediate(r))
    expect(got.map((f) => f.kind)).toEqual(['event', 'result'])
    const sent: string[] = []
    child.stdin.on('data', (d: Buffer) => sent.push(String(d)))
    transport.send({ kind: 'notify', method: 'pty.write', params: { ptyId: 'p1', data: 'x' } })
    await new Promise((r) => setImmediate(r))
    expect(sent.join('')).toBe('{"kind":"notify","method":"pty.write","params":{"ptyId":"p1","data":"x"}}\n')
  })

  it('installs the same node-pty build the app ships', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@lydell/node-pty']).toBe(NODE_PTY_VERSION)
  })
})
