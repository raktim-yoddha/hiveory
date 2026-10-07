import { create } from 'zustand'
import type { BotView } from '@shared/domain/bot'
import type { ChatSummary } from '@shared/domain/chat'
import type { RequestOf } from '@shared/ipc/contract'
import { api } from '../lib/api'
import { useChat } from './chat'
import { reportError, runAction } from './notices'

type BotInput = RequestOf<'bots.create'>
type BotPatch = Omit<RequestOf<'bots.update'>, 'botId'>

interface BotsState {
  bots: BotView[]
  loaded: boolean
  activeBotId: string | null
  /** Each bot's threads, newest first. */
  threads: Record<string, ChatSummary[]>
  /** The thread open for each bot. */
  activeThread: Record<string, string>
  /** The bot panel beside the conversation (Computer for now). */
  panelOpen: boolean
  setPanelOpen(open: boolean): void
  load(): Promise<void>
  loadThreads(botId: string): Promise<void>
  select(botId: string): Promise<void>
  openThread(botId: string, threadId: string): Promise<void>
  newThread(botId: string): Promise<void>
  create(input: BotInput): Promise<BotView | null>
  update(botId: string, patch: BotPatch): Promise<void>
  remove(botId: string): Promise<void>
  /** A streamed update to a bot thread (from chat.event). */
  applyThread(summary: ChatSummary): void
}

/** Bots mode state. Bots and their threads live in main; thread messages share the chat store. */
export const useBots = create<BotsState>((set, get) => ({
  bots: [],
  loaded: false,
  activeBotId: null,
  threads: {},
  activeThread: {},
  panelOpen: false,

  setPanelOpen: (panelOpen) => set({ panelOpen }),

  load: async () => {
    try {
      const bots = await api('bots.list')
      set((s) => ({
        bots,
        loaded: true,
        activeBotId: s.activeBotId && bots.some((b) => b.id === s.activeBotId) ? s.activeBotId : (bots[0]?.id ?? null)
      }))
      const active = get().activeBotId
      if (active && !get().threads[active]) await get().select(active)
    } catch (error) {
      set({ loaded: true })
      reportError(error, 'Load bots')
    }
  },

  loadThreads: async (botId) => {
    try {
      const threads = await api('bots.threads', { botId })
      set((s) => ({ threads: { ...s.threads, [botId]: threads } }))
    } catch (error) {
      reportError(error, 'Load threads')
    }
  },

  select: async (botId) => {
    set({ activeBotId: botId })
    await get().loadThreads(botId)
    const threads = get().threads[botId] ?? []
    const current = get().activeThread[botId]
    const pick = threads.find((t) => t.id === current) ?? threads[0]
    if (pick) await get().openThread(botId, pick.id)
  },

  openThread: async (botId, threadId) => {
    set((s) => ({ activeThread: { ...s.activeThread, [botId]: threadId } }))
    await useChat.getState().load(threadId)
  },

  newThread: async (botId) => {
    const thread = await runAction('New thread', () => api('bots.newThread', { botId }))
    if (!thread) return
    useChat.setState((s) => ({ chats: { ...s.chats, [thread.id]: { ...thread, running: false } } }))
    set((s) => ({ activeThread: { ...s.activeThread, [botId]: thread.id } }))
    await get().loadThreads(botId)
  },

  create: async (input) => {
    const bot = await runAction('Create bot', () => api('bots.create', input))
    if (!bot) return null
    set((s) => ({ bots: [...s.bots.filter((b) => b.id !== bot.id), bot] }))
    await get().load()
    await get().select(bot.id)
    return bot
  },

  update: async (botId, patch) => {
    const bot = await runAction('Update bot', () => api('bots.update', { botId, ...patch }))
    if (bot) await get().load()
  },

  remove: async (botId) => {
    await runAction('Delete bot', () => api('bots.delete', { botId }))
    set((s) => {
      const threads = { ...s.threads }
      delete threads[botId]
      return { threads, activeBotId: s.activeBotId === botId ? null : s.activeBotId }
    })
    await get().load()
  },

  applyThread: (summary) =>
    set((s) => {
      const botId = summary.botId
      if (!botId) return {}
      const list = s.threads[botId] ?? []
      const next = list.some((t) => t.id === summary.id) ? list.map((t) => (t.id === summary.id ? summary : t)) : [summary, ...list]
      const running = next.filter((t) => t.running).length
      return {
        threads: { ...s.threads, [botId]: next },
        bots: s.bots.map((b) => (b.id === botId ? { ...b, running, threads: next.length, lastActivity: summary.updatedAt } : b))
      }
    })
}))
