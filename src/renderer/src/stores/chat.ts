import { create } from 'zustand'
import type { ChatAttachment, ChatCatalog, ChatMessage, ChatSession, ChatSummary } from '@shared/domain/chat'
import type { RequestOf } from '@shared/ipc/contract'
import { api } from '../lib/api'
import { reportError, runAction } from './notices'

type LoadedChat = ChatSession & { running: boolean }

interface ChatState {
  /** The chats behind Work agents in chat view, by agent id (ADR 0037). */
  chats: Record<string, LoadedChat>
  catalogs: Record<string, ChatCatalog | 'loading'>
  clis: string[]
  loadClis(): Promise<void>
  load(chatId: string): Promise<void>
  update(chatId: string, patch: Omit<RequestOf<'chat.update'>, 'chatId'>): Promise<void>
  send(chatId: string, text: string, attachments?: ChatAttachment[]): Promise<boolean>
  stop(chatId: string): Promise<void>
  /** Lines a message up while the chat is answering (ADR 0031), or takes one back out. */
  queue(chatId: string, text: string): Promise<boolean>
  unqueue(chatId: string, index: number): Promise<void>
  loadCatalog(cliId: string, refresh?: boolean): Promise<void>
  applyEvent(chatId: string, message: ChatMessage, summary: ChatSummary): void
}

const LAST_CLI_KEY = 'hiveory.chatCli'

/** The CLI a new Chat UI starts on (ADR 0059): the one last picked in a chat here, else the first chat CLI installed. */
export const preferredChatCli = (installed: string[]): string | undefined => {
  let last: string | null = null
  try {
    last = localStorage.getItem(LAST_CLI_KEY)
  } catch {
    // Storage off: the first installed one.
  }
  return last && installed.includes(last) ? last : installed[0]
}

/** Drafts waiting for a chat's message box (a prompt link, ADR 0061): each is taken once. */
const pendingDrafts = new Map<string, string>()
export const DRAFT_EVENT = 'hiveory:draft'

/** Puts `text` in a chat's message box (never sends it): now if the box is open, else when it opens. */
export const offerChatDraft = (chatId: string, text: string): void => {
  pendingDrafts.set(chatId, text)
  window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: { chatId } }))
}

export const takeChatDraft = (chatId: string): string | undefined => {
  const text = pendingDrafts.get(chatId)
  pendingDrafts.delete(chatId)
  return text
}

export const rememberChatCli = (cliId: string): void => {
  try {
    localStorage.setItem(LAST_CLI_KEY, cliId)
  } catch {
    // Storage off: nothing to remember.
  }
}

/** Work agents' chats in chat view. Runs live in main; this mirrors them, so a reply is never interrupted. */
export const useChat = create<ChatState>((set, get) => ({
  chats: {},
  catalogs: {},
  clis: [],

  loadClis: async () => {
    const clis = await runAction('Detect chat CLIs', () => api('chat.clis'))
    if (clis) set({ clis })
  },

  load: async (chatId) => {
    const chat = await runAction('Open chat', () => api('chat.get', { chatId }))
    if (chat) set((s) => ({ chats: { ...s.chats, [chatId]: chat } }))
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
      if (!chat) return {}
      const index = chat.messages.findIndex((m) => m.id === message.id)
      const messages = index >= 0 ? chat.messages.map((m, i) => (i === index ? message : m)) : [...chat.messages, message]
      return { chats: { ...s.chats, [chatId]: { ...chat, messages, running: summary.running, title: summary.title, queued: summary.queued } } }
    })
}))
