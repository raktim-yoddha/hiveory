import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_BOT_MEMORY,
  MAX_DELEGATION_DEPTH,
  MAX_MEMORY_ENTRY,
  type Bot,
  type BotView
} from '@shared/domain/bot'
import type { ChatSession } from '@shared/domain/chat'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import { ToolError } from '../agent-tools/tool-args'
import type { ChatService } from '../chat/chat-service'
import type { Emit } from '../events'
import { nowIso } from '../events'
import type { StateStore } from '../persistence/state-store'

export type BotInput = Pick<Bot, 'name'> & Partial<Pick<Bot, 'brief' | 'cliId' | 'model' | 'effort' | 'autoApprove' | 'chief' | 'messaging' | 'pinned'>>
export type BotPatch = Partial<Pick<Bot, 'name' | 'brief' | 'cliId' | 'model' | 'effort' | 'autoApprove' | 'chief' | 'messaging' | 'pinned' | 'memory'>>

/** How long ask_bot waits for an answer before leaving it in the teammate's thread. */
export const ASK_TIMEOUT_MS = 10 * 60 * 1000
/** Results longer than this are cut when handed back to the bot that asked. */
const MAX_RESULT_CHARS = 8000
/** Delegations and consultations one thread may start per hour (a runaway loop stops here). */
const MAX_CALLS_PER_HOUR = 20

interface Pending {
  fromChatId: string
  /** delegate: the result is delivered into `fromChatId` as a new message; ask: a waiter resolves. */
  resolve?: (text: string) => void
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}\n…(cut)` : text)

/**
 * Bots mode (ADR 0022): persistent teammates over the shared chat engine. A bot
 * is an identity (brief, memory, default engine); its threads are chats tagged
 * with its id, working in the bot's own folder. The Chief of Staff can hand work
 * to other bots: their results come back into its thread and wake it, the way
 * OpenMausBot's delegate_bot and Grok Bot's bot-to-bot messages do. Delegation
 * is bounded by depth and an hourly budget so bots can never loop.
 */
export class BotService {
  private readonly pending = new Map<string, Pending>()
  /** Results waiting for a busy thread to finish its turn. */
  private readonly outbox = new Map<string, string[]>()
  private readonly calls = new Map<string, number[]>()

  constructor(
    private readonly store: StateStore,
    private readonly chats: ChatService,
    private readonly botsDir: string,
    private readonly emit: Emit,
    private readonly log: Logger
  ) {
    chats.on('run', (chatId, running) => {
      if (!running) this.onTurnEnd(chatId)
    })
  }

  list(): BotView[] {
    return this.store.state.bots.map((b) => this.view(b)).sort((a, b) => Number(b.chief) - Number(a.chief) || Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name))
  }

  get(botId: string): Bot {
    const bot = this.store.state.bots.find((b) => b.id === botId)
    if (!bot) fail('NOT_FOUND', 'Bot not found.')
    return bot!
  }

  find(botId: string): Bot | undefined {
    return this.store.state.bots.find((b) => b.id === botId)
  }

  /** The folder every thread of this bot works in (created on first use). */
  home(botId: string): string {
    const dir = join(this.botsDir, botId)
    try {
      mkdirSync(dir, { recursive: true })
    } catch (error) {
      this.log.warn(`Could not create the folder for bot ${botId}`, error)
    }
    return dir
  }

  create(input: BotInput): BotView {
    const name = this.uniqueName(input.name)
    const now = nowIso()
    const bot: Bot = {
      id: randomUUID(),
      name,
      brief: input.brief?.trim() ?? '',
      cliId: input.cliId || undefined,
      model: input.model || undefined,
      effort: input.effort || undefined,
      autoApprove: input.autoApprove ?? false,
      // The first bot leads the team until the user picks another Chief.
      chief: input.chief ?? !this.store.state.bots.some((b) => b.chief),
      messaging: input.messaging ?? true,
      memory: [],
      pinned: input.pinned ?? false,
      createdAt: now,
      updatedAt: now
    }
    this.store.update((s) => {
      if (bot.chief) for (const b of s.bots) b.chief = false
      s.bots.push(bot)
    })
    this.changed()
    return this.view(bot)
  }

  update(botId: string, patch: BotPatch): BotView {
    const bot = this.get(botId)
    if (patch.name !== undefined && patch.name.trim().toLowerCase() !== bot.name.toLowerCase()) patch.name = this.uniqueName(patch.name, botId)
    if (patch.memory) patch.memory = this.cleanMemory(patch.memory)
    this.store.update((s) => {
      const target = s.bots.find((b) => b.id === botId)
      if (!target) return
      if (patch.chief) for (const b of s.bots) b.chief = false
      Object.assign(target, patch, { brief: (patch.brief ?? target.brief).trim(), updatedAt: nowIso() })
      if (patch.cliId === '') target.cliId = undefined
      if (patch.model === '') target.model = undefined
      if (patch.effort === '') target.effort = undefined
    })
    this.changed()
    return this.view(this.get(botId))
  }

  /** Removes the bot and its threads. Its folder stays on disk: files a bot made are the user's. */
  delete(botId: string): void {
    this.get(botId)
    for (const thread of this.chats.threads(botId)) this.chats.delete(thread.id)
    this.store.update((s) => {
      s.bots = s.bots.filter((b) => b.id !== botId)
    })
    this.changed()
  }

  newThread(botId: string, title?: string, delegation?: ChatSession['delegation']): ChatSession {
    const bot = this.get(botId)
    return this.chats.createThread({
      botId,
      cwd: this.home(botId),
      cliId: bot.cliId,
      model: bot.model,
      effort: bot.effort,
      autoApprove: bot.autoApprove,
      title,
      delegation
    })
  }

  remember(botId: string, fact: string): string[] {
    const bot = this.get(botId)
    const text = fact.replace(/\s+/g, ' ').trim()
    if (!text) throw new ToolError('Say what to remember.')
    if (bot.memory.some((m) => m.toLowerCase() === text.toLowerCase())) return bot.memory
    if (bot.memory.length >= MAX_BOT_MEMORY) throw new ToolError(`Memory is full (${MAX_BOT_MEMORY} notes). Forget an old note first.`)
    return this.update(botId, { memory: [...bot.memory, text] }).memory
  }

  forget(botId: string, fact: string): string[] {
    const bot = this.get(botId)
    const needle = fact.trim().toLowerCase()
    const next = bot.memory.filter((m) => m.toLowerCase() !== needle)
    if (next.length === bot.memory.length) throw new ToolError('No note matches that text exactly. Copy it from your memory list.')
    return this.update(botId, { memory: next }).memory
  }

  /** What a bot's thread is told before its first turn: who it is, its brief and what it remembers. */
  preamble(chat: ChatSession): string | undefined {
    const bot = chat.botId ? this.find(chat.botId) : undefined
    if (!bot) return undefined
    const role = bot.chief ? ` You are the Chief of Staff: the user's main contact, who hands work to the right teammate and brings the results together.` : ''
    const memory = bot.memory.length ? bot.memory.map((m) => `- ${m}`).join('\n') : '- (nothing yet)'
    return [
      `You are "${bot.name}", one of the user's bots in Hiveory.${role}`,
      `Your brief:\n${bot.brief || '(not written yet — ask the user what you should own)'}`,
      `What you remember from earlier conversations:\n${memory}`,
      'Save lasting facts with the remember tool and drop stale ones with forget. Never store passwords, keys or other secrets.',
      chat.delegation ? `This conversation was opened by ${this.find(chat.delegation.fromBotId)?.name ?? 'another bot'} to hand you work; your reply goes back to them.` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  /** Bots the bot behind `chatId` may contact: the Chief reaches everyone; others reach bots that allow messaging. */
  reachable(chatId: string): Bot[] {
    const self = this.botOf(chatId)
    return this.store.state.bots.filter((b) => b.id !== self.id && (self.chief || (self.messaging && (b.messaging || b.chief))))
  }

  /** Hands work to a teammate in a new thread. Returns at once; the result arrives in `fromChatId` as a message. */
  delegate(fromChatId: string, target: string, brief: string): { threadId: string; bot: string } {
    const { from, to, depth } = this.checkCall(fromChatId, target, true)
    const thread = this.newThread(to.id, `From ${from.name}: ${brief}`, { fromChatId, fromBotId: from.id, depth: depth + 1 })
    this.pending.set(thread.id, { fromChatId })
    this.start(thread, `${from.name}${from.chief ? ' (Chief of Staff)' : ''} assigned you this:\n\n${brief}\n\nDo the work, then reply with the outcome. Your reply goes back to ${from.name} automatically.`)
    return { threadId: thread.id, bot: to.name }
  }

  /** Consults a teammate and waits for its answer (up to `timeoutMs`). */
  ask(fromChatId: string, target: string, question: string, timeoutMs = ASK_TIMEOUT_MS): Promise<string> {
    const { from, to, depth } = this.checkCall(fromChatId, target, false)
    const thread = this.newThread(to.id, `${from.name} asks: ${question}`, { fromChatId, fromBotId: from.id, depth: depth + 1 })
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(thread.id)
        resolve(`${to.name} is still working on it. The answer will stay in its thread "${thread.title}"; delegate instead for long work.`)
      }, timeoutMs)
      this.pending.set(thread.id, {
        fromChatId,
        resolve: (text) => {
          clearTimeout(timer)
          resolve(text)
        }
      })
      this.start(thread, `${from.name} asks you (answer briefly; your reply goes straight back to them):\n\n${question}`)
    })
  }

  private start(thread: ChatSession, text: string): void {
    try {
      this.chats.send(thread.id, text)
    } catch (error) {
      this.pending.delete(thread.id)
      const bot = this.find(thread.botId ?? '')
      const why = error instanceof Error ? error.message : String(error)
      throw new ToolError(`${bot?.name ?? 'That bot'} could not start: ${why}${bot && !bot.cliId ? ' (it has no engine set; the user can choose one in its settings).' : ''}`)
    }
  }

  private checkCall(fromChatId: string, target: string, delegating: boolean): { from: Bot; to: Bot; depth: number } {
    const chat = this.chats.get(fromChatId)
    const from = this.botOf(fromChatId)
    if (delegating && !from.chief) throw new ToolError('Only the Chief of Staff delegates work. Use ask_bot to consult a teammate.')
    const depth = chat.delegation?.depth ?? 0
    if (depth >= MAX_DELEGATION_DEPTH) throw new ToolError('This conversation was itself handed down twice; do the work here instead of passing it on.')
    const wanted = target.trim().toLowerCase()
    const to = this.reachable(fromChatId).find((b) => b.id === target || b.name.toLowerCase() === wanted)
    if (!to) throw new ToolError(`No reachable bot called "${target}". Call list_bots for the exact names.`)
    const now = Date.now()
    const recent = (this.calls.get(fromChatId) ?? []).filter((t) => now - t < 60 * 60 * 1000)
    if (recent.length >= MAX_CALLS_PER_HOUR) throw new ToolError(`This conversation reached ${MAX_CALLS_PER_HOUR} handoffs in an hour. Finish with what you have.`)
    this.calls.set(fromChatId, [...recent, now])
    return { from, to, depth }
  }

  private botOf(chatId: string): Bot {
    const chat = this.chats.get(chatId)
    const bot = chat.botId ? this.find(chat.botId) : undefined
    if (!bot) throw new ToolError('Only bots can use these tools.')
    return bot
  }

  private onTurnEnd(chatId: string): void {
    const waiting = this.pending.get(chatId)
    if (waiting) {
      this.pending.delete(chatId)
      const thread = this.chats.get(chatId)
      const bot = this.find(thread.botId ?? '')
      const last = [...thread.messages].reverse().find((m) => m.role === 'assistant')
      const reply = clip(this.chats.lastReply(chatId), MAX_RESULT_CHARS)
      const text = last?.error && !reply.trim() ? `${bot?.name ?? 'The bot'} could not finish: ${last.error}` : reply
      if (waiting.resolve) waiting.resolve(text)
      else this.deliver(waiting.fromChatId, `[Result from ${bot?.name ?? 'a teammate'} · "${thread.title}"]\n${text}`)
    }
    // This thread just finished a turn: results that arrived meanwhile go in now, as one message.
    const queued = this.outbox.get(chatId)
    if (queued?.length) {
      this.outbox.delete(chatId)
      this.deliver(chatId, queued.join('\n\n'))
    }
  }

  /** Puts a teammate's result into a thread and wakes it; a busy thread gets it after its current turn. */
  private deliver(chatId: string, text: string): void {
    if (!this.chats.find(chatId)) return
    if (this.chats.isRunning(chatId)) {
      this.outbox.set(chatId, [...(this.outbox.get(chatId) ?? []), text])
      return
    }
    try {
      this.chats.send(chatId, text)
    } catch (error) {
      this.log.warn(`Could not hand a result to ${chatId}`, error)
    }
  }

  private cleanMemory(memory: string[]): string[] {
    const seen = new Set<string>()
    return memory
      .map((m) => m.replace(/\s+/g, ' ').trim().slice(0, MAX_MEMORY_ENTRY))
      .filter((m) => m && !seen.has(m.toLowerCase()) && seen.add(m.toLowerCase()))
      .slice(0, MAX_BOT_MEMORY)
  }

  /** Names stay unique (case-insensitive) so "ask Scout" is never ambiguous. */
  private uniqueName(name: string, exceptId?: string): string {
    const base = name.replace(/\s+/g, ' ').trim()
    if (!base) fail('INVALID_INPUT', 'Give the bot a name.')
    const taken = new Set(this.store.state.bots.filter((b) => b.id !== exceptId).map((b) => b.name.toLowerCase()))
    if (!taken.has(base.toLowerCase())) return base
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
  }

  private view(bot: Bot): BotView {
    const threads = this.chats.threads(bot.id)
    return {
      ...bot,
      memory: [...bot.memory],
      home: join(this.botsDir, bot.id),
      threads: threads.length,
      running: threads.filter((t) => t.running).length,
      lastActivity: threads[0]?.updatedAt
    }
  }

  private changed(): void {
    this.emit('state.changed', { topic: 'bots' })
  }
}
