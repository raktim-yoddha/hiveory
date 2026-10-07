import { create } from 'zustand'
import type { Computer } from '../api/client'
import { secureStore, type KeyValueStore } from '../storage/secure'

const LIST_KEY = 'hiveory.computers'
const tokenKey = (id: string): string => `hiveory.token.${id.replace(/[^A-Za-z0-9._-]/g, '_')}`

export interface ComputersState {
  loaded: boolean
  computers: Computer[]
  activeId: string | null
  /** Device tokens, by computer id: read from secure storage once, then kept in memory. */
  tokens: Record<string, string>
  load(): Promise<void>
  /** Remembers a newly paired computer and makes it the active one. */
  add(computer: Computer, token: string): Promise<void>
  remove(id: string): Promise<void>
  setActive(id: string): Promise<void>
}

/**
 * The computers this phone is paired with. The list (names and addresses) and
 * each device token live in secure storage; the tokens never leave it except
 * in the Authorization header of a call to their own computer.
 */
export const createComputersStore = (storage: KeyValueStore) =>
  create<ComputersState>((set, get) => {
    const persist = async (): Promise<void> => {
      const { computers, activeId } = get()
      await storage.set(LIST_KEY, JSON.stringify({ computers, activeId }))
    }
    return {
      loaded: false,
      computers: [],
      activeId: null,
      tokens: {},
      load: async () => {
        let saved: { computers?: Computer[]; activeId?: string | null } = {}
        try {
          saved = JSON.parse((await storage.get(LIST_KEY)) ?? '{}')
        } catch {
          // Unreadable: start over (pairing again is one scan).
        }
        const computers = saved.computers ?? []
        const tokens: Record<string, string> = {}
        for (const c of computers) {
          const token = await storage.get(tokenKey(c.id))
          if (token) tokens[c.id] = token
        }
        // A computer whose token is gone cannot be used: forget it.
        const usable = computers.filter((c) => tokens[c.id])
        const activeId = usable.some((c) => c.id === saved.activeId) ? (saved.activeId ?? null) : (usable[0]?.id ?? null)
        set({ loaded: true, computers: usable, tokens, activeId })
      },
      add: async (computer, token) => {
        await storage.set(tokenKey(computer.id), token)
        set((s) => ({
          computers: [...s.computers.filter((c) => c.id !== computer.id), computer],
          tokens: { ...s.tokens, [computer.id]: token },
          activeId: computer.id
        }))
        await persist()
      },
      remove: async (id) => {
        await storage.remove(tokenKey(id))
        set((s) => {
          const computers = s.computers.filter((c) => c.id !== id)
          const { [id]: _gone, ...tokens } = s.tokens
          return { computers, tokens, activeId: s.activeId === id ? (computers[0]?.id ?? null) : s.activeId }
        })
        await persist()
      },
      setActive: async (id) => {
        if (!get().computers.some((c) => c.id === id)) return
        set({ activeId: id })
        await persist()
      }
    }
  })

export const useComputers = createComputersStore(secureStore)

/** The computer the app is showing, with its token; null before pairing. */
export const useActiveComputer = (): { computer: Computer; token: string } | null => {
  const computer = useComputers((s) => s.computers.find((c) => c.id === s.activeId))
  const token = useComputers((s) => (s.activeId ? s.tokens[s.activeId] : undefined))
  return computer && token ? { computer, token } : null
}
