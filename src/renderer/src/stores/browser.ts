import { create } from 'zustand'
import type { BrowserState } from '@shared/domain'
import { api } from '../lib/api'
import { reportError } from './notices'

interface BrowserStore extends BrowserState {
  load(): Promise<void>
  set(state: BrowserState): void
}

/** Cache of the built-in browser's pages, profiles and annotations (main owns them). */
export const useBrowser = create<BrowserStore>((set) => ({
  pages: [],
  profiles: [],
  annotations: [],
  load: async () => {
    try {
      set(await api('browser.state'))
    } catch (error) {
      reportError(error, 'Load browser')
    }
  },
  set: (state) => set(state)
}))
