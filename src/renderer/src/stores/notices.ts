import { create } from 'zustand'
import type { AppError } from '@shared/errors'
import { toAppError } from '../lib/api'

export interface Notice {
  id: number
  level: 'info' | 'warning' | 'error'
  message: string
  error?: AppError
}

interface NoticeState {
  notices: Notice[]
  push(notice: Omit<Notice, 'id'>): void
  dismiss(id: number): void
}

let nextId = 1

export const useNotices = create<NoticeState>((set) => ({
  notices: [],
  push: (notice) => {
    const id = nextId++
    set((s) => ({ notices: [...s.notices.slice(-4), { ...notice, id }] }))
    if (notice.level !== 'error') setTimeout(() => useNotices.getState().dismiss(id), 6000)
  },
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
}))

export const reportError = (error: unknown, operation?: string): void => {
  const appError = toAppError(error, operation)
  useNotices.getState().push({ level: 'error', message: appError.message, error: appError })
}

/** Runs a user action; failures become a visible, recoverable notice instead of an unhandled rejection. */
export const runAction = async <T>(operation: string, action: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await action()
  } catch (error) {
    reportError(error, operation)
    return undefined
  }
}
