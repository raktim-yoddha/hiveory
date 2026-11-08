import { create } from 'zustand'

interface TerminalActivityState {
  /** Terminals that printed while nobody could see them (their tab says "New output"). */
  fresh: Record<string, true>
  printed(instanceId: string): void
  seen(instanceId: string): void
}

/** Output a terminal printed off screen, until it is on screen again. */
export const useTerminalActivity = create<TerminalActivityState>((set) => ({
  fresh: {},
  printed: (instanceId) => set((s) => (s.fresh[instanceId] ? s : { fresh: { ...s.fresh, [instanceId]: true } })),
  seen: (instanceId) =>
    set((s) => {
      if (!s.fresh[instanceId]) return s
      const next = { ...s.fresh }
      delete next[instanceId]
      return { fresh: next }
    })
}))
