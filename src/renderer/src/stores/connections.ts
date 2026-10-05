import { create } from 'zustand'
import type { ConnectionRequirements, ConnectionView } from '@shared/domain'
import { api } from '../lib/api'
import { reportError } from './notices'

interface ConnectionsState {
  connections: ConnectionView[]
  requirements: ConnectionRequirements | null
  load(): Promise<void>
  /** Puts a connection returned by an action into the list straight away (the broadcast follows). */
  put(connection: ConnectionView): void
}

/** MCP servers and plugins Hiveory runs for every agent (ADR 0017). Main holds the secrets; this holds views. */
export const useConnections = create<ConnectionsState>((set) => ({
  connections: [],
  requirements: null,
  load: async () => {
    try {
      const [connections, requirements] = await Promise.all([api('connections.list'), api('connections.requirements')])
      set({ connections, requirements })
    } catch (error) {
      reportError(error, 'Load plugins')
    }
  },
  put: (connection) =>
    set((s) => ({
      connections: s.connections.some((c) => c.id === connection.id)
        ? s.connections.map((c) => (c.id === connection.id ? connection : c))
        : [...s.connections, connection]
    }))
}))
