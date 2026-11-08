import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import type { ChangeSet, ChangeSource } from '@shared/domain/changes'
import { api, subscribe } from '../../lib/api'

/** Views showing the same worktree's changes share one reading, at most this often unless forced. */
const FRESH_MS = 2000
/** While on screen, the changes are read again this often (agents change files all the time). */
const POLL_MS = 10_000

interface Reading {
  set?: ChangeSet
  error?: string
  at: number
}

interface ChangeSets {
  readings: Record<string, Reading>
  load(workspaceId: string, source: ChangeSource, force?: boolean): Promise<void>
}

const keyOf = (workspaceId: string, source: ChangeSource): string => `${workspaceId}:${JSON.stringify(source)}`
const inFlight = new Map<string, Promise<void>>()

const useChangeSets = create<ChangeSets>((set, get) => ({
  readings: {},
  load: (workspaceId, source, force = false) => {
    const key = keyOf(workspaceId, source)
    const running = inFlight.get(key)
    if (running) return running
    const last = get().readings[key]
    if (!force && last && Date.now() - last.at < FRESH_MS) return Promise.resolve()
    const done = api('changes.list', { workspaceId, source })
      .then((changes) => set((s) => ({ readings: { ...s.readings, [key]: { set: changes, at: Date.now() } } })))
      .catch((error: unknown) =>
        set((s) => ({ readings: { ...s.readings, [key]: { ...s.readings[key], error: error instanceof Error ? error.message : String(error), at: Date.now() } } }))
      )
      .finally(() => inFlight.delete(key))
    inFlight.set(key, done)
    return done
  }
}))

/**
 * A worktree's changes for `source` (ADR 0058), kept current: read again when an agent there changes
 * state, when its files change, when the window comes back, and every few seconds while visible.
 */
export function useChangeSet(workspaceId: string | undefined, source: ChangeSource) {
  const key = workspaceId ? keyOf(workspaceId, source) : ''
  const reading = useChangeSets((s) => (key ? s.readings[key] : undefined))
  const sourceKey = JSON.stringify(source)

  const refresh = useCallback(
    (force = true) => (workspaceId ? useChangeSets.getState().load(workspaceId, JSON.parse(sourceKey) as ChangeSource, force) : Promise.resolve()),
    [workspaceId, sourceKey]
  )

  useEffect(() => {
    if (!workspaceId) return
    void refresh(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(false), 600)
    }
    const offs = [
      subscribe('runtime.changed', (e) => e.workspaceId === workspaceId && soon()),
      subscribe('files.changed', (e) => e.scope === workspaceId && soon())
    ]
    // ponytail: polling while visible; a Git index watcher in main would make this push-only.
    const poll = setInterval(() => document.visibilityState === 'visible' && void refresh(false), POLL_MS)
    window.addEventListener('focus', soon)
    return () => {
      clearTimeout(timer)
      clearInterval(poll)
      window.removeEventListener('focus', soon)
      for (const off of offs) off()
    }
  }, [workspaceId, refresh])

  return { changes: reading?.set, error: reading?.error, loading: !reading, refresh }
}
