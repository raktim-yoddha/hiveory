import type { ChatMessage, ChatPart } from '@shared/domain/chat'
import type { ChatEvent } from './parsers'

/**
 * Folds normalized chat events into an assistant message's parts, in order.
 * Text/thinking parts are keyed so streamed deltas and the final full text
 * land in the same part; tool parts are upserted by id.
 */
export class ChatAccumulator {
  private readonly keys = new Map<string, number>()
  sessionId?: string
  errors: string[] = []
  done = false

  constructor(readonly message: ChatMessage) {}

  apply(event: ChatEvent): void {
    const parts = this.message.parts
    switch (event.type) {
      case 'session':
        this.sessionId = event.id
        return
      case 'error':
        if (!this.errors.includes(event.message)) this.errors.push(event.message)
        return
      case 'done':
        this.done = true
        return
      case 'text':
      case 'thinking': {
        const key = `${event.type}:${event.key}`
        const index = this.keys.get(key)
        if (index === undefined) {
          const text = event.full ?? event.delta ?? ''
          if (!text) return
          this.keys.set(key, parts.length)
          parts.push({ kind: event.type, text } as ChatPart)
          return
        }
        const part = parts[index] as Extract<ChatPart, { kind: 'text' | 'thinking' }>
        part.text = event.full ?? part.text + (event.delta ?? '')
        return
      }
      case 'tool': {
        const key = `tool:${event.id}`
        const index = this.keys.get(key)
        if (index === undefined) {
          this.keys.set(key, parts.length)
          parts.push({ kind: 'tool', id: event.id, name: event.name ?? 'Tool', detail: event.detail, output: event.output, status: event.status })
          return
        }
        const part = parts[index] as Extract<ChatPart, { kind: 'tool' }>
        if (event.name) part.name = event.name
        if (event.detail) part.detail = event.detail
        if (event.output !== undefined) part.output = event.output
        part.status = event.status
      }
    }
  }

  /** Plain text of the answer (for transcripts and titles). */
  text(): string {
    return this.message.parts
      .filter((p): p is Extract<ChatPart, { kind: 'text' }> => p.kind === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim()
  }
}
