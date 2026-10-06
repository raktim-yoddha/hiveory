import { create } from 'zustand'
import type { ConnectionView } from '@shared/domain'
import { api } from '../lib/api'
import { reportError } from './notices'

interface ConnectionsState {
  connections: ConnectionView[]
  load(): Promise<void>
  /** Puts a connection returned by an action into the list straight away (the broadcast follows). */
  put(connection: ConnectionView): void
}

/** MCP servers and the Composio account Hiveory runs for every agent (ADR 0017, 0023). Main holds the secrets; this holds views. */
export const useConnections = create<ConnectionsState>((set) => ({
  connections: [],
  load: async () => {
    try {
      set({ connections: await api('connections.list') })
    } catch (error) {
      reportError(error, 'Load apps')
    }
  },
  put: (connection) =>
    set((s) => ({
      connections: s.connections.some((c) => c.id === connection.id)
        ? s.connections.map((c) => (c.id === connection.id ? connection : c))
        : [...s.connections, connection]
    }))
}))
