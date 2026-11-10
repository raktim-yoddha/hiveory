import type { ChatMessage, ChatPart, ChatSummary } from './chat'

/**
 * Text added to one part of a reply while it streams (ADR 0068). `at` is where the text starts in
 * that part, so applying an append twice, or after a reload that already holds some of it, never
 * duplicates or loses a character (as terminal output is merged by its offsets).
 */
export interface ChatAppend {
  /** Index of the part in the message's `parts`. */
  part: number
  at: number
  text: string
}

/** What a viewer was last told about a streaming reply: its text parts, and everything else as one key. */
export interface ChatSent {
  texts: Array<string | null>
  rest: string
}

const hasText = (part: ChatPart): part is Extract<ChatPart, { kind: 'text' | 'thinking' }> => part.kind === 'text' || part.kind === 'thinking'

/** A reply as a viewer holds it once told about it: compared with the next state to send only what was added. */
export const chatSent = (message: ChatMessage, summary: ChatSummary): ChatSent => ({
  // The strings themselves, not copies: a text only ever grows into a new string.
  texts: message.parts.map((p) => (hasText(p) ? p.text : null)),
  // ponytail: everything that is not streamed text, serialized each time; tool output makes this as long as that output.
  rest: JSON.stringify([{ ...message, parts: message.parts.map((p) => (hasText(p) ? p.kind : p)) }, summary])
})

/**
 * The text added since `before`, when that is all that changed (none: an empty list). Null when
 * anything else did (a new part, a tool, tasks, the end, the title…): then the whole message is sent.
 */
export const chatAppends = (before: ChatSent | null, now: ChatSent): ChatAppend[] | null => {
  if (!before || before.rest !== now.rest || before.texts.length !== now.texts.length) return null
  const appends: ChatAppend[] = []
  for (let part = 0; part < now.texts.length; part++) {
    const was = before.texts[part]
    const is = now.texts[part]
    if (was === is) continue
    // Rewritten, not added to (the final message of a CLI can replace its streamed text).
    if (typeof was !== 'string' || typeof is !== 'string' || !is.startsWith(was)) return null
    appends.push({ part, at: was.length, text: is.slice(was.length) })
  }
  return appends
}

/**
 * `message` with `appends` applied, or null when one does not fit (a part that is missing or not
 * text, or text that starts past what is held): the viewer then asks for the whole chat again.
 */
export const applyChatAppends = (message: ChatMessage, appends: ChatAppend[]): ChatMessage | null => {
  const parts = [...message.parts]
  for (const { part, at, text } of appends) {
    const held = parts[part]
    if (!held || !hasText(held) || at > held.text.length) return null
    // Text from `at` on that is already held (a reload was ahead of this append) is not added again.
    const fresh = text.slice(held.text.length - at)
    if (fresh) parts[part] = { ...held, text: held.text + fresh }
  }
  return { ...message, parts }
}
