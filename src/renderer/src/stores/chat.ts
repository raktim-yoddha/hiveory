import { create } from 'zustand'
import type { ChatAttachment, ChatCatalog, ChatMessage, ChatSession, ChatSummary } from '@shared/domain/chat'
import type { RequestOf } from '@shared/ipc/contract'
import { api } from '../lib/api'
import { reportError, runAction } from './notices'

type LoadedChat = ChatSession & { running: boolean }

interface ChatState {
  summaries: ChatSummary[]
  activeId: string | null
  chats: Record<string, LoadedChat>
  catalogs: Record<string, ChatCatalog | 'loading'>
  clis: string[]
  loadList(): Promise<void>
  loadClis(): Promise<void>
  open(chatId: string): Promise<void>
  /** Loads a chat without making it the active Chat-mode chat (Work agents in chat view). */
  load(chatId: string): Promise<void>
  create(projectId?: string): Promise<void>
  update(chatId: string, patch: Omit<RequestOf<'chat.update'>, 'chatId'>): Promise<void>
  send(chatId: string, text: string, attachments?: ChatAttachment[]): Promise<boolean>
  stop(chatId: string): Promise<void>
  /** Lines a message up while the chat is answering (ADR 0031), or takes one back out. */
  queue(chatId: string, text: string): Promise<boolean>
  unqueue(chatId: string, index: number): Promise<void>
  remove(chatId: string): Promise<void>
  rename(chatId: string, title: string): Promise<void>
  loadCatalog(cliId: string, refresh?: boolean): Promise<void>
  applyEvent(chatId: string, message: ChatMessage, summary: ChatSummary): void
}

/** Chat state. Runs live in main; this mirrors them, so switching modes never interrupts a reply. */
export const useChat = create<ChatState>((set, get) => ({
  summaries: [],
  activeId: null,
  chats: {},
  catalogs: {},
  clis: [],

  loadList: async () => {
    try {
      const summaries = await api('chat.list')
      set((s) => ({
        summaries,
        chats: Object.fromEntries(
          Object.entries(s.chats).map(([id, chat]) => [id, { ...chat, running: summaries.find((x) => x.id === id)?.running ?? chat.running }])
        )
      }))
    } catch (error) {
      reportError(error, 'Load chats')
    }
  },

  loadClis: async () => {
    const clis = await runAction('Detect chat CLIs', () => api('chat.clis'))
    if (clis) set({ clis })
  },

  open: async (chatId) => {
    set({ activeId: chatId })
    await get().load(chatId)
  },

  load: async (chatId) => {
    const chat = await runAction('Open chat', () => api('chat.get', { chatId }))
    if (chat) set((s) => ({ chats: { ...s.chats, [chatId]: chat } }))
  },

  create: async (projectId) => {
    const chat = await runAction('New chat', () => api('chat.create', { projectId }))
    if (!chat) return
    set((s) => ({ activeId: chat.id, chats: { ...s.chats, [chat.id]: { ...chat, running: false } } }))
    void get().loadList()
  },

  queue: async (id, text) => {
    const ok = await runAction('Queue message', async () => {
      await api('chat.queue', { chatId: id, text })
      return true
    })
    await get().load(id)
    return ok === true
  },

  unqueue: async (id, index) => {
    await runAction('Remove queued message', () => api('chat.unqueue', { chatId: id, index }))
    await get().load(id)
  },

  update: async (id, patch) => {
    const chat = await runAction('Update chat', () => api('chat.update', { chatId: id, ...patch }))
    if (chat) set((s) => ({ chats: { ...s.chats, [id]: { ...chat, running: s.chats[id]?.running ?? false } } }))
  },

  send: async (id, text, attachments = []) => {
    const ok = await runAction('Send message', async () => {
      await api('chat.send', { chatId: id, text, attachments })
      return true
    })
    // The user message and streaming reply arrive via events; refresh to include the user turn immediately.
    if (ok) await get().load(id)
    return Boolean(ok)
  },

  stop: async (id) => {
    await runAction('Stop', () => api('chat.stop', { chatId: id }))
  },

  remove: async (chatId) => {
    await runAction('Delete chat', () => api('chat.delete', { chatId }))
    set((s) => {
      const chats = { ...s.chats }
      delete chats[chatId]
      return { chats, activeId: s.activeId === chatId ? null : s.activeId }
    })
    void get().loadList()
  },

  rename: async (chatId, title) => {
    await get().update(chatId, { title })
    void get().loadList()
  },

  loadCatalog: async (cliId, refresh = false) => {
    const current = get().catalogs[cliId]
    if (current && !refresh) return
    set((s) => ({ catalogs: { ...s.catalogs, [cliId]: 'loading' } }))
    try {
      const catalog = await api('chat.catalog', { cliId, refresh })
      set((s) => ({ catalogs: { ...s.catalogs, [cliId]: catalog } }))
    } catch (error) {
      set((s) => ({ catalogs: { ...s.catalogs, [cliId]: { cliId, models: [], error: 'Could not list models.' } } }))
      reportError(error, 'List models')
    }
  },

  applyEvent: (chatId, message, summary) =>
    set((s) => {
      const chat = s.chats[chatId]
      // Chats behind Work agents, and bot threads, never appear in the Chat list.
      const summaries = summary.agentId || summary.botId
        ? s.summaries
        : s.summaries.some((x) => x.id === chatId)
          ? s.summaries.map((x) => (x.id === chatId ? summary : x))
          : [summary, ...s.summaries]
      if (!chat) return { summaries }
      const index = chat.messages.findIndex((m) => m.id === message.id)
      const messages = index >= 0 ? chat.messages.map((m, i) => (i === index ? message : m)) : [...chat.messages, message]
      return { summaries, chats: { ...s.chats, [chatId]: { ...chat, messages, running: summary.running, title: summary.title, queued: summary.queued } } }
    })
}))
