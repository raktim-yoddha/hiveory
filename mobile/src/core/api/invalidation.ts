import type { PhoneChannel, ServerEvent } from './contract'

/**
 * Which cached answers a live event makes stale. Screens never poll: the
 * computer says what changed and only those queries refetch.
 */
export const staleChannels = (event: ServerEvent): PhoneChannel[] => {
  switch (event.event) {
    case 'state.changed': {
      const { topic, chatId } = (event as ServerEvent<'state.changed'>).payload
      if (topic === 'projects') return ['projects.list', 'kanban.board']
      if (topic === 'workspaces') return ['workspaces.list', 'kanban.board']
      if (topic === 'agents') return ['agents.list', 'workspaces.list', 'kanban.board']
      if (topic === 'presets') return ['presets.list']
      if (topic === 'settings') return ['settings.get']
      // A chat's model or effort changed (maybe on the computer): the open chat reloads.
      if (topic === 'chats' && chatId) return ['chat.get', 'chat.list', 'bots.threads']
      // Chats and bot threads came or went (the Chat and Bots tabs, ADR 0039).
      if (topic === 'chats') return ['chat.list', 'bots.threads', 'bots.list']
      if (topic === 'bots') return ['bots.list']
      return []
    }
    case 'runtime.changed':
      return ['agents.list', 'kanban.board']
    case 'hosts.changed':
      return ['hosts.status']
    default:
      return []
  }
}
