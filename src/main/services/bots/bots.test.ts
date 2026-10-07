import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatSession, ChatSummary } from '@shared/domain/chat'
import type { ChatService } from '../chat/chat-service'
import { parseState } from '../persistence/schema'
import { StateStore } from '../persistence/state-store'
import { BotService } from './bot-service'
import { BotTools } from './bot-tools'
import { TeamService } from './team-service'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }

/** Just enough of ChatService: threads live in memory, a "turn" runs until the test finishes it. */
class FakeChats extends EventEmitter<{ run: [chatId: string, running: boolean] }> {
  readonly sessions = new Map<string, ChatSession>()
  readonly running = new Set<string>()
  private n = 0

  createThread(input: Partial<ChatSession> & { title?: string }): ChatSession {
    const chat = { id: `t${++this.n}`, title: input.title ?? 'New chat', cwd: input.cwd ?? '', autoApprove: false, messages: [], createdAt: '', updatedAt: `${this.n}`, ...input } as ChatSession
    this.sessions.set(chat.id, chat)
    return chat
  }
  threads(botId: string): ChatSummary[] {
    return [...this.sessions.values()].filter((c) => c.botId === botId).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, running: this.running.has(c.id), botId }))
  }
  find(id: string) {
    return this.sessions.get(id)
  }
  get(id: string): ChatSession {
    const chat = this.sessions.get(id)
    if (!chat) throw new Error('Chat not found.')
    return chat
  }
  send(id: string, text: string): void {
    const chat = this.get(id)
    if (this.running.has(id)) throw new Error('still answering')
    if (!chat.cliId) throw new Error('Choose a CLI first.')
    chat.messages.push({ id: `m${chat.messages.length}`, role: 'user', parts: [{ kind: 'text', text }], createdAt: '' })
    this.running.add(id)
    this.emit('run', id, true)
  }
  /** The test plays the CLI: the turn ends with this reply. */
  finish(id: string, reply: string, error?: string): void {
    this.get(id).messages.push({ id: 'r', role: 'assistant', parts: reply ? [{ kind: 'text', text: reply }] : [], createdAt: '', ...(error ? { error } : {}) })
    this.running.delete(id)
    this.emit('run', id, false)
  }
  isRunning(id: string): boolean {
    return this.running.has(id)
  }
  lastReply(id: string): string {
    const last = [...this.get(id).messages].reverse().find((m) => m.role === 'assistant')
    return last ? last.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n') : ''
  }
  delete(id: string): void {
    this.sessions.delete(id)
  }
  userTexts(id: string): string[] {
    return this.get(id).messages.filter((m) => m.role === 'user').map((m) => (m.parts[0] as { text: string }).text)
  }
}

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'hv-bots-'))
  const store = new StateStore(join(root, 'state.json'), log)
  const chats = new FakeChats()
  const bots = new BotService(store, chats as unknown as ChatService, join(root, 'Bots'), () => undefined, log)
  const tools = new BotTools(bots, chats as unknown as ChatService)
  return { store, chats, bots, tools }
}

describe('bots', () => {
  it('makes the first bot the Chief of Staff and keeps exactly one', () => {
    const { bots } = setup()
    const lead = bots.create({ name: 'Lead', cliId: 'claude' })
    const scout = bots.create({ name: 'Scout', cliId: 'claude' })
    expect([lead.chief, scout.chief]).toEqual([true, false])
    bots.update(scout.id, { chief: true })
    expect(bots.list().filter((b) => b.chief).map((b) => b.name)).toEqual(['Scout'])
  })

  it('keeps names unique and memory clean', () => {
    const { bots } = setup()
    const a = bots.create({ name: 'Scout' })
    expect(bots.create({ name: 'scout' }).name).toBe('scout 2')
    expect(bots.update(a.id, { memory: ['  Likes  tea ', 'likes tea', ''] }).memory).toEqual(['Likes tea'])
  })

  it('starts on Auto, and refuses "its Linux computer" until one is set up', () => {
    const { bots } = setup()
    const bot = bots.create({ name: 'Scout' })
    expect(bot.worksOn).toBe('auto')
    expect(() => bots.update(bot.id, { worksOn: 'container' })).toThrow('Linux computer')
    expect(bots.update(bot.id, { worksOn: 'container', computer: { kind: 'docker' } }).worksOn).toBe('container')
    expect(() => bots.update(bot.id, { computer: null })).toThrow('Linux computer')
    expect(bots.update(bot.id, { worksOn: 'browser', computer: null }).computer).toBeUndefined()
  })

  it('gives a bot its own browser profile once, and a fresh one if the user deleted it', () => {
    const { bots } = setup()
    const made: Array<{ id: string; name: string; createdAt: string }> = [{ id: 'p0', name: 'Bot · Scout', createdAt: '' }]
    let n = 0
    const profiles = { list: () => made, create: (name: string) => (made.push({ id: `p${++n}`, name, createdAt: '' }), made.at(-1)!) }
    const bot = bots.create({ name: 'Scout' })
    const first = bots.browserProfile(bot.id, profiles)
    expect(made.find((p) => p.id === first)?.name).toBe('Bot · Scout 2')
    expect(bots.browserProfile(bot.id, profiles)).toBe(first)
    expect(bots.get(bot.id).browserProfileId).toBe(first)
    made.splice(made.findIndex((p) => p.id === first), 1)
    expect(bots.browserProfile(bot.id, profiles)).not.toBe(first)
  })

  it('opens threads in the bot folder with its defaults, and briefs the first turn', () => {
    const { bots } = setup()
    const bot = bots.create({ name: 'Writer', brief: 'Draft release notes.', cliId: 'codex', autoApprove: true })
    bots.remember(bot.id, 'The product is called Hiveory.')
    const thread = bots.newThread(bot.id)
    expect(thread).toMatchObject({ botId: bot.id, cliId: 'codex', autoApprove: true, cwd: bots.home(bot.id) })
    const intro = bots.preamble(thread)!
    expect(intro).toContain('You are "Writer"')
    expect(intro).toContain('Draft release notes.')
    expect(intro).toContain('- The product is called Hiveory.')
    expect(intro).toContain('Chief of Staff')
    expect(bots.preamble({ ...thread, botId: undefined })).toBeUndefined()
  })

  it('delegates: the result comes back into the Chief thread and wakes it', async () => {
    const { bots, chats, tools } = setup()
    const chief = bots.create({ name: 'Chief', cliId: 'claude' })
    const scout = bots.create({ name: 'Scout', cliId: 'claude' })
    const lead = bots.newThread(chief.id)

    const res = await tools.call({ id: lead.id }, 'delegate_bot', { bot: 'scout', brief: 'Find three leads.' })
    expect(res.isError).toBeFalsy()
    const [work] = chats.threads(scout.id)
    expect(chats.userTexts(work!.id)[0]).toContain('Find three leads.')
    expect(chats.get(work!.id).delegation).toEqual({ fromChatId: lead.id, fromBotId: chief.id, depth: 1 })

    chats.finish(work!.id, 'Found Ada, Lin and Sam.')
    expect(chats.userTexts(lead.id).at(-1)).toContain('[Result from Scout')
    expect(chats.userTexts(lead.id).at(-1)).toContain('Found Ada, Lin and Sam.')
    expect(chats.isRunning(lead.id)).toBe(true)
  })

  it('holds results for a busy Chief until its turn ends, then sends them together', () => {
    const { bots, chats } = setup()
    const chief = bots.create({ name: 'Chief', cliId: 'claude' })
    const a = bots.create({ name: 'A', cliId: 'claude' })
    const b = bots.create({ name: 'B', cliId: 'claude' })
    const lead = bots.newThread(chief.id)
    chats.send(lead.id, 'go')
    bots.delegate(lead.id, 'A', 'one')
    bots.delegate(lead.id, 'B', 'two')
    chats.finish(chats.threads(a.id)[0]!.id, 'done one')
    chats.finish(chats.threads(b.id)[0]!.id, 'done two')
    expect(chats.userTexts(lead.id)).toEqual(['go'])
    chats.finish(lead.id, 'waiting for the team')
    const delivered = chats.userTexts(lead.id).at(-1)!
    expect(delivered).toContain('done one')
    expect(delivered).toContain('done two')
  })

  it('answers ask_bot with the reply, and reports a failed turn', async () => {
    const { bots, chats } = setup()
    const chief = bots.create({ name: 'Chief', cliId: 'claude' })
    const expert = bots.create({ name: 'Expert', cliId: 'claude' })
    const lead = bots.newThread(chief.id)
    const answer = bots.ask(lead.id, 'Expert', 'Which port?')
    chats.finish(chats.threads(expert.id)[0]!.id, 'Port 3000.')
    await expect(answer).resolves.toBe('Port 3000.')
    const failed = bots.ask(lead.id, 'Expert', 'Again?')
    chats.finish(chats.threads(expert.id).at(-1)!.id, '', 'Rate limited')
    await expect(failed).resolves.toBe('Expert could not finish: Rate limited')
  })

  it('times out ask_bot without losing the thread', async () => {
    const { bots, chats } = setup()
    const chief = bots.create({ name: 'Chief', cliId: 'claude' })
    const slow = bots.create({ name: 'Slow', cliId: 'claude' })
    const answer = bots.ask(bots.newThread(chief.id).id, 'Slow', 'Hello?', 5)
    await expect(answer).resolves.toContain('still working')
    expect(chats.threads(slow.id)).toHaveLength(1)
  })

  it('bounds who may contact whom, and how deep work is handed down', async () => {
    const { bots, chats, tools } = setup()
    const chief = bots.create({ name: 'Chief', cliId: 'claude' })
    const member = bots.create({ name: 'Member', cliId: 'claude' })
    const loner = bots.create({ name: 'Loner', cliId: 'claude', messaging: false })
    const memberThread = bots.newThread(member.id)

    // Only the Chief delegates; a member consults bots that allow messaging, never a loner.
    await expect(tools.call({ id: memberThread.id }, 'delegate_bot', { bot: 'Chief', brief: 'x' })).rejects.toThrow('Only the Chief')
    expect(bots.reachable(memberThread.id).map((b) => b.name)).toEqual(['Chief'])
    expect(bots.reachable(bots.newThread(loner.id).id)).toEqual([])
    expect(bots.reachable(bots.newThread(chief.id).id).map((b) => b.name).sort()).toEqual(['Loner', 'Member'])

    // A thread handed down twice cannot pass work on again.
    const deep = chats.createThread({ botId: chief.id, cliId: 'claude', delegation: { fromChatId: 'x', fromBotId: member.id, depth: 2 } })
    expect(() => bots.delegate(deep.id, 'Member', 'more')).toThrow('handed down twice')
    expect(() => bots.delegate(bots.newThread(chief.id).id, 'Nobody', 'x')).toThrow('No reachable bot')
  })

  it('explains a teammate with no engine instead of failing silently', () => {
    const { bots } = setup()
    const chief = bots.create({ name: 'Chief', cliId: 'claude' })
    bots.create({ name: 'Idle' })
    expect(() => bots.delegate(bots.newThread(chief.id).id, 'Idle', 'x')).toThrow('no engine set')
  })

  it('remembers and forgets through tools', async () => {
    const { bots, tools } = setup()
    const bot = bots.create({ name: 'Notes', cliId: 'claude' })
    const thread = bots.newThread(bot.id)
    await tools.call({ id: thread.id }, 'remember', { fact: 'Ship on Fridays' })
    expect(bots.get(bot.id).memory).toEqual(['Ship on Fridays'])
    await tools.call({ id: thread.id }, 'forget', { fact: 'ship on fridays' })
    expect(bots.get(bot.id).memory).toEqual([])
  })

  it('deletes a bot with its threads', () => {
    const { bots, chats } = setup()
    const bot = bots.create({ name: 'Temp', cliId: 'claude' })
    bots.newThread(bot.id)
    bots.delete(bot.id)
    expect(bots.list()).toEqual([])
    expect(chats.threads(bot.id)).toEqual([])
  })

  it('persists bots and repairs a file with two Chiefs', () => {
    const now = 'x'
    const bot = (id: string, chief: boolean) => ({ id, name: id, brief: '', autoApprove: false, chief, messaging: true, memory: [], pinned: false, createdAt: now, updatedAt: now })
    const { state, rejected } = parseState({ bots: [bot('a', true), bot('b', true), { id: 'broken' }] })
    expect(state.bots.map((b) => [b.id, b.chief])).toEqual([['a', true], ['b', false]])
    expect(rejected).toBe(1)
  })
})

describe('teams', () => {
  const withTeams = () => {
    const s = setup()
    const teams = new TeamService(s.store, () => undefined, (botId) => s.chats.threads(botId).some((t) => t.running))
    return { ...s, teams }
  }

  it('gives each team its own Chief, and a bot that moves leads only a team without one', () => {
    const { bots, teams } = withTeams()
    const sales = teams.create('Sales')
    const lead = bots.create({ name: 'Lead', cliId: 'claude' })
    const closer = bots.create({ name: 'Closer', cliId: 'claude', teamId: sales.id })
    const scout = bots.create({ name: 'Scout', cliId: 'claude', teamId: sales.id })
    expect([lead.chief, closer.chief, scout.chief]).toEqual([true, true, false])
    bots.update(scout.id, { chief: true })
    expect(bots.list().filter((b) => b.chief).map((b) => b.name).sort()).toEqual(['Lead', 'Scout'])
    // Moving a Chief into a team that has one: it steps down there.
    expect(bots.update(lead.id, { teamId: sales.id }).chief).toBe(false)
    // Into a team without one: it leads.
    expect(bots.update(closer.id, { teamId: 'general' }).chief).toBe(true)
    expect(() => bots.update(scout.id, { teamId: 'nowhere' })).toThrow('Team not found')
  })

  it('lets a Chief reach its own team, and Chiefs reach each other through General', () => {
    const { bots, teams } = withTeams()
    const sales = teams.create('Sales')
    const ops = teams.create('Ops')
    bots.create({ name: 'Boss', cliId: 'claude' })
    const salesChief = bots.create({ name: 'Seller', cliId: 'claude', teamId: sales.id })
    bots.create({ name: 'Rep', cliId: 'claude', teamId: sales.id, messaging: false })
    // Runner does not allow messaging: only Chiefs reach it, and only through General.
    bots.create({ name: 'Runner', cliId: 'claude', teamId: ops.id, messaging: false })
    const reach = (id: string) => bots.reachable(bots.newThread(id).id).map((b) => b.name).sort()
    expect(reach(bots.list().find((b) => b.name === 'Boss')!.id)).toEqual(['Runner', 'Seller'])
    expect(reach(salesChief.id)).toEqual(['Boss', 'Rep'])
  })

  it('names teams uniquely, keeps General, and moves bots home when a team goes', () => {
    const { bots, teams, chats } = withTeams()
    const sales = teams.create('Sales')
    expect(() => teams.create(' sales ')).toThrow('already a team')
    expect(teams.rename(sales.id, 'Revenue').name).toBe('Revenue')
    expect(() => teams.delete('general')).toThrow("can't be deleted")
    bots.create({ name: 'Boss', cliId: 'claude' })
    const seller = bots.create({ name: 'Seller', cliId: 'claude', teamId: sales.id })
    const thread = bots.newThread(seller.id)
    chats.running.add(thread.id)
    expect(() => teams.delete(sales.id)).toThrow('running work')
    chats.running.delete(thread.id)
    teams.delete(sales.id)
    expect(bots.get(seller.id)).toMatchObject({ teamId: 'general', chief: false })
    expect(teams.list().map((t) => t.name)).toEqual(['General'])
  })

  it('lists work bots handed each other for the team map', async () => {
    const { bots, tools } = withTeams()
    const chief = bots.create({ name: 'Chief', cliId: 'claude' })
    const member = bots.create({ name: 'Member', cliId: 'claude' })
    await tools.call({ id: bots.newThread(chief.id).id }, 'delegate_bot', { bot: 'Member', brief: 'Draft the notes.' })
    expect(bots.handoffs()).toMatchObject([{ fromBotId: chief.id, toBotId: member.id, running: true }])
  })

  it('puts bots saved before teams into General and keeps one Chief per team', () => {
    const bot = (id: string, chief: boolean, teamId?: string) => ({ id, name: id, brief: '', autoApprove: false, chief, messaging: true, memory: [], pinned: false, createdAt: 'x', updatedAt: 'x', ...(teamId ? { teamId } : {}) })
    const { state } = parseState({
      teams: [{ id: 't1', name: 'Sales', createdAt: 'x' }],
      bots: [bot('a', true), bot('b', true, 't1'), bot('c', true, 'gone')]
    })
    expect(state.teams.map((t) => t.id)).toEqual(['general', 't1'])
    expect(state.bots.map((b) => [b.id, b.teamId, b.chief])).toEqual([
      ['a', 'general', true],
      ['b', 't1', true],
      ['c', 'general', false]
    ])
  })
})

describe('bot overview data', () => {
  it('keeps a one-line blurb for rosters, notifies by default, and previews the first-turn prompt', async () => {
    const { bots, tools } = setup()
    const bot = bots.create({ name: 'Scout', cliId: 'claude', brief: 'Owns research.', blurb: '  Finds sources fast.  ' })
    expect(bot).toMatchObject({ blurb: 'Finds sources fast.', notify: true })
    const other = bots.create({ name: 'Other', cliId: 'claude' })
    expect((await tools.call({ id: bots.newThread(other.id).id }, 'list_bots', {})).text).toContain('Finds sources fast.')
    expect(bots.preview(bot.id)).toContain('Owns research.')
    expect(bots.update(bot.id, { blurb: '' }).blurb).toBeUndefined()
  })
})
