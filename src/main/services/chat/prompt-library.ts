import { randomUUID } from 'node:crypto'
import { MAX_PROMPT_TITLE, MAX_SAVED_PROMPTS, promptTitle, type SavedPrompt } from '@shared/domain/prompt'
import { fail } from '@shared/errors'
import type { Emit } from '../events'
import { nowIso } from '../events'
import type { StateStore } from '../persistence/state-store'

/** The user's saved prompts (ADR 0031), newest first. */
export class PromptLibrary {
  constructor(
    private readonly store: StateStore,
    private readonly emit: Emit
  ) {}

  list(): SavedPrompt[] {
    return this.store.state.savedPrompts.map((p) => ({ ...p }))
  }

  /** Saves a new prompt, or replaces the text and title of one with `id`. */
  save(input: { id?: string; title?: string; text: string }): SavedPrompt {
    const text = input.text.trim()
    if (!text) fail('INVALID_INPUT', 'Type the prompt first.')
    const title = (input.title?.trim() || promptTitle(text)).slice(0, MAX_PROMPT_TITLE)
    const existing = input.id ? this.store.state.savedPrompts.find((p) => p.id === input.id) : undefined
    if (input.id && !existing) fail('NOT_FOUND', 'That prompt was removed.')
    if (!existing && this.store.state.savedPrompts.length >= MAX_SAVED_PROMPTS) fail('INVALID_INPUT', `You have ${MAX_SAVED_PROMPTS} saved prompts. Remove one first.`)
    const prompt: SavedPrompt = existing ? { ...existing, title, text } : { id: randomUUID(), title, text, createdAt: nowIso() }
    this.store.update((s) => {
      s.savedPrompts = existing ? s.savedPrompts.map((p) => (p.id === prompt.id ? prompt : p)) : [prompt, ...s.savedPrompts]
    })
    this.emit('state.changed', { topic: 'prompts' })
    return prompt
  }

  delete(promptId: string): void {
    this.store.update((s) => {
      s.savedPrompts = s.savedPrompts.filter((p) => p.id !== promptId)
    })
    this.emit('state.changed', { topic: 'prompts' })
  }
}
