import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatSession } from '@shared/domain/chat'
import type { Logger } from '../../app/logger'

const ID = /^[A-Za-z0-9_-]{1,128}$/

/** One JSON file per chat (chats can be long; the main state file stays small). Atomic writes. */
export class ChatStore {
  private readonly chats = new Map<string, ChatSession>()

  constructor(
    private readonly dir: string,
    private readonly log: Logger
  ) {}

  load(): void {
    let files: string[] = []
    try {
      mkdirSync(this.dir, { recursive: true })
      files = readdirSync(this.dir).filter((f) => f.endsWith('.json'))
    } catch (error) {
      this.log.error('Chat folder unreadable', error)
    }
    for (const file of files) {
      try {
        const chat = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as ChatSession
        if (!chat?.id || !ID.test(chat.id) || !Array.isArray(chat.messages)) continue
        // A run cannot survive a restart; finish any message that was mid-stream.
        for (const m of chat.messages) if (m.streaming) Object.assign(m, { streaming: false, error: m.error ?? 'Interrupted' })
        this.chats.set(chat.id, chat)
      } catch (error) {
        this.log.warn(`Skipping unreadable chat ${file}`, error)
      }
    }
  }

  all(): ChatSession[] {
    return [...this.chats.values()]
  }

  get(id: string): ChatSession | undefined {
    return this.chats.get(id)
  }

  save(chat: ChatSession): void {
    this.chats.set(chat.id, chat)
    try {
      mkdirSync(this.dir, { recursive: true })
      const file = join(this.dir, `${chat.id}.json`)
      writeFileSync(`${file}.tmp`, JSON.stringify(chat), 'utf8')
      renameSync(`${file}.tmp`, file)
    } catch (error) {
      this.log.error(`Failed to save chat ${chat.id}`, error)
    }
  }

  delete(id: string): void {
    this.chats.delete(id)
    try {
      rmSync(join(this.dir, `${id}.json`), { force: true })
    } catch (error) {
      this.log.warn(`Failed to delete chat ${id}`, error)
    }
  }
}
