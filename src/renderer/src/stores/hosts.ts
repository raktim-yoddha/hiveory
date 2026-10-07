import { create } from 'zustand'
import type { HostLinkStatus } from '@shared/domain'
import type { SshPrompt } from '@shared/domain/tailnet'
import { api } from '../lib/api'

interface HostLinksState {
  /** By host key; hosts Hiveory has not used yet are absent. */
  statuses: Record<string, HostLinkStatus>
  loaded: boolean
  ensure(): void
  set(key: string, status: HostLinkStatus): void
}

/** The link to each remote host (ADR 0025), kept current by `hosts.changed`. */
export const useHostLinks = create<HostLinksState>((set, get) => ({
  statuses: {},
  loaded: false,
  ensure: () => {
    if (get().loaded) return
    set({ loaded: true })
    void api('hosts.status')
      .then((statuses) => set((s) => ({ statuses: { ...statuses, ...s.statuses } })))
      .catch(() => undefined)
  },
  set: (key, status) => set((s) => ({ statuses: { ...s.statuses, [key]: status } }))
}))

interface SshPromptsState {
  queue: SshPrompt[]
  load(): void
  add(prompt: SshPrompt): void
  remove(id: string): void
}

/** Questions ssh is waiting on, oldest first (ADR 0025). */
export const useSshPrompts = create<SshPromptsState>((set) => ({
  queue: [],
  load: () =>
    void api('ssh.pending')
      .then((pending) => set((s) => ({ queue: [...s.queue, ...pending.filter((p) => !s.queue.some((q) => q.id === p.id))] })))
      .catch(() => undefined),
  add: (prompt) => set((s) => (s.queue.some((q) => q.id === prompt.id) ? s : { queue: [...s.queue, prompt] })),
  remove: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) }))
}))
