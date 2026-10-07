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
