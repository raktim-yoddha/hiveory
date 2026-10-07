import { create } from 'zustand'
import { HiveoryError } from './api/client'

export interface Notice {
  id: number
  level: 'info' | 'error'
  message: string
  hint?: string
}

interface NoticesState {
  notices: Notice[]
  push(notice: Omit<Notice, 'id'>): void
  dismiss(id: number): void
}

const SHOW_MS = 4500
let seq = 0

/** Short messages at the bottom of the screen (a failed action, a reconnect). */
export const useNotices = create<NoticesState>((set, get) => ({
  notices: [],
  push: (notice) => {
    const id = ++seq
    // One at a time on a phone: the newest replaces the rest.
    set({ notices: [{ ...notice, id }] })
    setTimeout(() => get().dismiss(id), SHOW_MS)
  },
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
}))

/** Shows any failure as a notice, with the computer's own hint when it gave one. */
export const reportError = (error: unknown): void => {
  const e = error instanceof HiveoryError ? error.error : { message: error instanceof Error ? error.message : 'Something went wrong.' }
  useNotices.getState().push({ level: 'error', message: e.message, hint: 'hint' in e ? e.hint : undefined })
}
