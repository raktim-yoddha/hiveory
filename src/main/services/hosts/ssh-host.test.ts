import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { HostFrame } from '@shared/host/protocol'
import { explainSshFailure, isSafeDestination, lineTransport, managedNodeBuild, MANAGED_NODE_SHA256, NODE_PTY_VERSION, nodeInstallScript, parseProbe, SshHostConnector } from './ssh-host'

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
    expect(parseProbe('Linux\naarch64\n/home/dev\nnone\nmusl\n').libc).toBe('musl')
  })

  it('explains ssh failures with a next step', () => {
    const code = (stderr: string) => {
      try {
        explainSshFailure('box', stderr)
      } catch (e) {
        return (e as { error: { code: string; hint?: string } }).error
      }
    }
    expect(code('Host key verification failed.')).toMatchObject({ code: 'FORBIDDEN', hint: expect.stringContaining('fingerprint') })
    expect(code('@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@')).toMatchObject({ code: 'FORBIDDEN', message: expect.stringContaining('has changed') })
    expect(code('dev@box: Permission denied (publickey).')).toMatchObject({ code: 'FORBIDDEN', hint: expect.stringContaining('Key login') })
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

  it("installs Hiveory's own Node only where an official build runs, checked against pinned sums", () => {
    const info = (platform: string, arch: string, libc?: string) => ({ platform, arch, home: '/h', node: '', ...(libc ? { libc } : {}) })
    expect(managedNodeBuild(info('linux', 'x86_64', 'glibc'))).toBe('linux-x64')
    expect(managedNodeBuild(info('linux', 'aarch64', 'glibc'))).toBe('linux-arm64')
    expect(managedNodeBuild(info('darwin', 'arm64'))).toBe('darwin-arm64')
    expect(managedNodeBuild(info('linux', 'x86_64', 'musl'))).toBeNull()
    expect(managedNodeBuild(info('linux', 'armv7l', 'glibc'))).toBeNull()
    expect(managedNodeBuild(info('freebsd', 'amd64'))).toBeNull()
    for (const [build, sum] of Object.entries(MANAGED_NODE_SHA256)) {
      expect(sum).toMatch(/^[a-f0-9]{64}$/)
      const script = nodeInstallScript(build)
      expect(script).toContain(sum)
      expect(script).toContain(`${build}.tar.gz`)
      // It goes to the login shell inside sh -c '...': no single quotes.
      expect(script).not.toContain("'")
    }
  })

  it('runs every remote command under sh, so any login shell works', async () => {
    const seen: string[][] = []
    const connector = new SshHostConnector('unused', log, [], (_file, args) => {
      seen.push(args)
      const child = fakeChild()
      setImmediate(() => {
        ;(child.stdout as unknown as PassThrough).end('Linux\nx86_64\n/home/dev\nv22.1.0\nglibc\n')
        setImmediate(() => child.emit('close', 0))
      })
      return child
    })
    const info = await connector.probe({ destination: 'box' })
    expect(info).toMatchObject({ platform: 'linux', node: '22.1.0', libc: 'glibc' })
    const command = seen[0]!.at(-1)!
    expect(command.startsWith("sh -c '")).toBe(true)
    expect(command).toContain('.hiveory-host/node/bin')
    // No window to ask in: batch mode, never a prompt on a missing terminal.
    expect(seen[0]).toContain('BatchMode=yes')
  })

  it('installs the same node-pty build the app ships', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@lydell/node-pty']).toBe(NODE_PTY_VERSION)
  })
})
