/**
 * Saved prompts (ADR 0031): text the user reuses, inserted into any message box (Chat, a bot's
 * thread, a Work agent in chat view). The user's own words, kept on this computer.
 */
export interface SavedPrompt {
  id: string
  title: string
  text: string
  createdAt: string
}

export const MAX_SAVED_PROMPTS = 100
export const MAX_PROMPT_TITLE = 60
export const MAX_SAVED_PROMPT_TEXT = 20_000
/** Messages that may wait while a chat is still answering (ADR 0031). */
export const MAX_QUEUED = 10

/** A prompt's title when the user gave none: its first line, cut short. */
export const promptTitle = (text: string): string => {
  const first = text.trim().split('\n')[0]!.replace(/\s+/g, ' ')
  return first.length > MAX_PROMPT_TITLE ? `${first.slice(0, MAX_PROMPT_TITLE - 1)}…` : first
}
