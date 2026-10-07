import { describe, expect, it } from 'vitest'
import type { Bot } from '@shared/domain/bot'
import { parseState } from '../persistence/schema'
import type { HostKit } from '../hosts/host-kit'
import { BotComputers, containerName } from './bot-computer'
import { COMPUTER_DOCKERFILE, COMPUTER_IMAGE } from './computer-image'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const bot = (computer?: Bot['computer']): Bot => ({
  id: 'b1',
  name: 'Builder',
  brief: '',
  autoApprove: false,
  chief: false,
  messaging: true,
  memory: [],
  pinned: false,
  worksOn: 'auto',
  routines: false,
  approvals: 'sends',
  teamId: 'general',
  notify: true,
  ...(computer ? { computer } : {}),
  createdAt: '',
  updatedAt: ''
})

/** A kit whose `docker` answers from a script, recording every call. */
const fakeKit = (answer: (args: string[]) => { code: number | null; stdout?: string; stderr?: string }) => {
  const calls: string[][] = []
  const kit = {
    remote: false,
    label: 'This computer',
    exec: async ({ file, args }: { file: string; args: string[] }) => {
      calls.push([file, ...args])
      const r = answer(args)
      return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
    }
  } as unknown as HostKit
  return { kit, calls }
}

describe('bot computers', () => {
  it('names containers per bot, safe for Docker', () => {
    expect(containerName('8f2c-41aa-9e0b-77d1')).toBe('hiveory-computer-8f2c41aa9e0b77d1')
  })

  it('reports no computer for a bot without one, without touching Docker', async () => {
    const { kit, calls } = fakeKit(() => ({ code: 0 }))
    const computers = new BotComputers(() => bot(), { kit: async () => kit }, () => '/bots/b1', log)
    expect(await computers.status('b1')).toEqual({ state: 'off' })
    expect(calls).toEqual([])
  })

  it('creates a hardened container with the bot folder at /workspace and only a loopback desktop port', async () => {
    let created = false
    const { kit, calls } = fakeKit((args) => {
      if (args[0] === 'inspect') return created ? { code: 0, stdout: 'true b1' } : { code: 1 }
      if (args[0] === 'run') created = true
      return { code: 0 }
    })
    const computers = new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => kit }, () => '/bots/b1', log)
    await computers.ensure('b1')
    const run = calls.find((c) => c[1] === 'run')!
    expect(run).toEqual(expect.arrayContaining(['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-p', '127.0.0.1::6080', '-v', '/bots/b1:/workspace', 'com.hiveory.computer=b1', COMPUTER_IMAGE]))
  })

  it('builds the image from the embedded Dockerfile when it is missing', async () => {
    const stdins: string[] = []
    const kit = {
      remote: false,
      exec: async ({ args, stdin }: { args: string[]; stdin?: string }) => {
        if (stdin) stdins.push(stdin)
        if (args[0] === 'image') return { code: 1, stdout: '', stderr: '' }
        if (args[0] === 'inspect') return { code: 0, stdout: 'true b1', stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
      }
    } as unknown as HostKit
    await new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => kit }, () => '/bots/b1', log).ensure('b1')
    expect(stdins).toEqual([COMPUTER_DOCKERFILE])
  })

  it("refuses a container of the same name that isn't the bot's", async () => {
    const { kit } = fakeKit((args) => (args[0] === 'inspect' ? { code: 0, stdout: 'true someone-else' } : { code: 0 }))
    const computers = new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => kit }, () => '/bots/b1', log)
    await expect(computers.ensure('b1')).rejects.toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('lends the desktop to one conversation at a time', () => {
    const computers = new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => ({}) as HostKit }, () => '', log)
    computers.claim('b1', 't1', () => 'First')
    expect(() => computers.claim('b1', 't2', () => 'First')).toThrow('in use by another conversation ("First")')
    computers.claim('b1', 't1', () => 'First')
    computers.release('t1')
    expect(() => computers.claim('b1', 't2', () => 'Second')).not.toThrow()
  })

  it('refuses keys that are not key names', async () => {
    const { kit } = fakeKit(() => ({ code: 0, stdout: 'true b1' }))
    const computers = new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => kit }, () => '', log)
    await expect(computers.key('b1', 'ctrl+l; rm -rf /')).rejects.toThrow('Keys look like')
  })

  it('keeps the computer setting in saved state, dropping a malformed one', () => {
    const base = { id: 'b', name: 'B', brief: '', autoApprove: false, chief: false, messaging: true, memory: [], pinned: false, createdAt: '', updatedAt: '' }
    const { state } = parseState({
      bots: [
        { ...base, id: 'a', computer: { kind: 'docker', host: { kind: 'ssh', destination: 'vps' } } },
        { ...base, id: 'b', computer: { kind: 'vm' } }
      ]
    })
    expect(state.bots.map((b) => b.computer)).toEqual([{ kind: 'docker', host: { kind: 'ssh', destination: 'vps' } }, undefined])
  })

  it('gives bots saved before "Works on" the browser and their Linux computer, and drops an unknown choice', () => {
    const base = { name: 'B', brief: '', autoApprove: false, chief: false, messaging: true, memory: [], pinned: false, createdAt: '', updatedAt: '' }
    const { state } = parseState({
      bots: [
        { ...base, id: 'a' },
        { ...base, id: 'b', worksOn: 'this-computer' },
        { ...base, id: 'c', worksOn: 'cloud' }
      ]
    })
    expect(state.bots.map((b) => b.worksOn)).toEqual(['auto', 'this-computer', 'auto'])
  })
})

describe('bot computers: engines, seats and rebuilds (ADR 0032)', () => {
  /** A kit per engine: `engines` answer their check, `files` records the engine of every call. */
  const kitWith = (engines: Record<string, 'running' | 'stopped' | 'absent'>, answer: (args: string[]) => { code: number | null; stdout?: string; stderr?: string } = () => ({ code: 0 })) => {
    const calls: string[][] = []
    const stdins: string[] = []
    const kit = {
      remote: false,
      label: 'This computer',
      exec: async ({ file, args, stdin }: { file: string; args: string[]; stdin?: string }) => {
        calls.push([file, ...args])
        if (stdin) stdins.push(stdin)
        const state = engines[file] ?? 'absent'
        if (state === 'absent') return { code: null, stdout: '', stderr: `spawn ${file} ENOENT` }
        if (args[0] === 'version' || args[0] === 'info') return state === 'running' ? { code: 0, stdout: '1', stderr: '' } : { code: 1, stdout: '', stderr: 'cannot connect' }
        const r = answer(args)
        return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
      }
    } as unknown as HostKit
    return { kit, calls, stdins }
  }

  it('uses Podman when Docker is not installed, building from stdin with an empty context folder', async () => {
    const { kit, calls, stdins } = kitWith({ podman: 'running' }, (args) => (args[0] === 'image' ? { code: 1 } : args[0] === 'inspect' ? { code: 0, stdout: 'true b1 2' } : { code: 0 }))
    await new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => kit }, () => '/bots/b1', log).ensure('b1')
    const build = calls.find((c) => c[1] === 'build')!
    expect(build.slice(0, 6)).toEqual(['podman', 'build', '-t', COMPUTER_IMAGE, '-f', '-'])
    expect(build[6]).toBeTruthy()
    expect(stdins).toEqual([COMPUTER_DOCKERFILE])
    expect(calls.filter((c) => c[0] === 'docker').length).toBe(1)
  })

  it('says which engine to start, or that neither is installed', async () => {
    const stopped = kitWith({ docker: 'stopped' })
    expect(await new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => stopped.kit }, () => '', log).status('b1')).toMatchObject({ state: 'unavailable', detail: 'Docker is not running.' })
    const none = kitWith({})
    expect(await new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => none.kit }, () => '', log).status('b1')).toMatchObject({ detail: 'Neither Docker nor Podman is installed.' })
  })

  it("seats a bot on another bot's computer: same container, one conversation across both", async () => {
    const owner = { ...bot({ kind: 'docker' }), id: 'owner', name: 'Owner' }
    const seat = { ...bot({ kind: 'shared', botId: 'owner' }), id: 'seat', name: 'Seat' }
    const bots: Record<string, Bot> = { owner, seat }
    const { kit, calls } = kitWith({ docker: 'running' }, (args) => (args[0] === 'inspect' ? { code: 0, stdout: 'true owner 2' } : { code: 0, stdout: 'aGk=' }))
    const computers = new BotComputers((id) => bots[id]!, { kit: async () => kit }, (id) => `/bots/${id}`, log)
    expect(await computers.status('seat')).toMatchObject({ state: 'running', sharedFrom: 'owner', engine: 'docker' })
    await computers.screenshot('seat')
    expect(calls.some((c) => c.includes(containerName('owner')) && c.includes('exec'))).toBe(true)
    computers.claim('owner', 't1', () => 'Owner thread')
    expect(() => computers.claim('seat', 't2', (id) => (id === 't1' ? 'Owner thread' : undefined))).toThrow('Owner thread')
  })

  it('offers a rebuild for an older image, and rebuilds only its own container', async () => {
    let removed = false
    const { kit, calls } = kitWith({ docker: 'running' }, (args) => {
      if (args[0] === 'inspect' && args[2]!.startsWith('{{index')) return { code: 0, stdout: 'b1' }
      if (args[0] === 'inspect') return { code: 0, stdout: removed ? 'true b1 2' : 'true b1 1' }
      if (args[0] === 'rm') removed = true
      return { code: 0 }
    })
    const computers = new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => kit }, () => '/bots/b1', log)
    expect(await computers.status('b1')).toMatchObject({ state: 'running', outdated: true })
    await computers.rebuild('b1')
    expect(calls.find((c) => c[1] === 'rm')).toEqual(['docker', 'rm', '-f', containerName('b1')])
    expect(await computers.status('b1')).not.toHaveProperty('outdated')
  })

  it('reads the UI tree, and asks for a rebuild when the image has no reader', async () => {
    let reader = true
    const { kit } = kitWith({ docker: 'running' }, (args) =>
      args[0] === 'inspect' ? { code: 0, stdout: 'true b1 2' } : args.some((x) => x.includes('hiveory-ui-tree')) ? (reader ? { code: 0, stdout: 'push button "Save" at 640,400' } : { code: 127, stderr: 'hiveory-ui-tree: not found' }) : { code: 0 }
    )
    const computers = new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => kit }, () => '', log)
    expect(await computers.uiTree('b1')).toBe('push button "Save" at 640,400')
    reader = false
    await expect(computers.uiTree('b1')).rejects.toThrow('rebuild it')
  })

  it('opens a page with the address as an argument, never as shell text', async () => {
    const { kit, calls } = kitWith({ docker: 'running' }, (args) => (args[0] === 'inspect' ? { code: 0, stdout: 'true b1 2' } : { code: 0 }))
    await new BotComputers(() => bot({ kind: 'docker' }), { kit: async () => kit }, () => '', log).openUrl('b1', 'https://example.com/?q=$(id)')
    const open = calls.find((c) => c.includes('--force-renderer-accessibility'))!
    expect(open.at(-1)).toBe('https://example.com/?q=$(id)')
    expect(open.find((a) => a.includes('exec chromium'))).not.toContain('example.com')
  })
})
