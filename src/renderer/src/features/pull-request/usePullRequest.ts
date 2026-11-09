import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import type { PullRequestDetail } from '@shared/domain/github'
import { api } from '../../lib/api'

/** Checks move while CI runs: read again this often while a view of it is on screen. */
const POLL_MS = 30_000
const FRESH_MS = 5_000

interface Reading {
  /** null: the branch has no review. */
  detail?: PullRequestDetail | null
  error?: string
  at: number
}

interface PullRequests {
  readings: Record<string, Reading>
  load(workspaceId: string, force?: boolean): Promise<void>
}

const inFlight = new Map<string, Promise<void>>()

export const usePullRequests = create<PullRequests>((set, get) => ({
  readings: {},
  load: (workspaceId, force = false) => {
    const running = inFlight.get(workspaceId)
    if (running) return running
    const last = get().readings[workspaceId]
    if (!force && last && Date.now() - last.at < FRESH_MS) return Promise.resolve()
    const done = api('github.pullRequestFor', { workspaceId })
      .then((detail) => set((s) => ({ readings: { ...s.readings, [workspaceId]: { detail, at: Date.now() } } })))
      .catch((error: unknown) =>
        set((s) => ({ readings: { ...s.readings, [workspaceId]: { ...s.readings[workspaceId], error: error instanceof Error ? error.message : String(error), at: Date.now() } } }))
      )
      .finally(() => inFlight.delete(workspaceId))
    inFlight.set(workspaceId, done)
    return done
  }
}))

/**
 * The worktree's review on its code host, with its checks (ADR 0064), kept current while shown:
 * the Pull request tab and the top bar's git button read the same one.
 */
export function usePullRequest(workspaceId: string) {
  const reading = usePullRequests((s) => s.readings[workspaceId])
  const refresh = useCallback((force = true) => usePullRequests.getState().load(workspaceId, force), [workspaceId])

  useEffect(() => {
    void refresh(false)
    const poll = setInterval(() => document.visibilityState === 'visible' && void refresh(false), POLL_MS)
    const onFocus = (): void => void refresh(false)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(poll)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  return { detail: reading?.detail, error: reading?.error && reading.detail === undefined ? reading.error : undefined, loading: !reading, refresh }
}
