import { create } from 'zustand'
import type { SavedPrompt } from '@shared/domain/prompt'
import { api } from '../lib/api'
import { runAction } from './notices'

interface PromptsState {
  prompts: SavedPrompt[]
  loaded: boolean
  load(): Promise<void>
  save(text: string, title?: string): Promise<void>
  remove(promptId: string): Promise<void>
}

/** The user's saved prompts (ADR 0031), for every message box. */
export const usePrompts = create<PromptsState>((set, get) => ({
  prompts: [],
  loaded: false,
  load: async () => {
    const prompts = await runAction('Load saved prompts', () => api('prompts.list'))
    set({ prompts: prompts ?? get().prompts, loaded: true })
  },
  save: async (text, title) => {
    if (await runAction('Save prompt', () => api('prompts.save', { text, ...(title ? { title } : {}) }))) await get().load()
  },
  remove: async (promptId) => {
    await runAction('Remove prompt', () => api('prompts.delete', { promptId }))
    await get().load()
  }
}))
