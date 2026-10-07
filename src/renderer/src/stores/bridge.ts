import { subscribe } from '../lib/api'
import { useAgents, useLayouts, usePresets, useProjects, useSettings, useUpdates, useWorkspaces } from './data'
import { useBots } from './bots'
import { useBrowser } from './browser'
import { useChat } from './chat'
import { useConnections } from './connections'
import { useEditors } from './editors'
import { useHostLinks, useSshPrompts } from './hosts'
import { useNotices } from './notices'
import { useVoice } from '../features/queen/voice'
import { useRoutines } from './routines'
import { useTriggers } from './triggers'
import { useApprovals } from './approvals'
import { usePrompts } from './prompts'
import { useNavigation } from './navigation'

/** Events arriving within this window trigger one reload per cache key. */
const COALESCE_MS = 24

/**
 * Wires main-process events to the renderer caches. Bursts (e.g. opening
 * five agents from a preset) collapse into a single reload per key.
 * Returns an unsubscribe for hot reload.
 */
export const installEventBridge = (): (() => void) => {
  const queued = new Map<string, () => Promise<void>>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const reload = (key: string, run: () => Promise<void>): void => {
    queued.set(key, run)
    timer ??= setTimeout(() => {
      timer = null
      const runs = [...queued.values()]
      queued.clear()
      for (const r of runs) void r()
    }, COALESCE_MS)
  }

  const offs = [
    subscribe('state.changed', ({ topic, projectId, workspaceId }) => {
      if (topic === 'projects') reload('projects', () => useProjects.getState().load())
      if (topic === 'presets') reload('presets', () => usePresets.getState().load())
      if (topic === 'settings') reload('settings', () => useSettings.getState().load())
      if (topic === 'chats') reload('chats', () => useChat.getState().loadList())
      if (topic === 'bots') reload('bots', () => useBots.getState().load())
      if (topic === 'routines') reload('routines', () => useRoutines.getState().load())
      if (topic === 'triggers') reload('triggers', () => useTriggers.getState().load())
      if (topic === 'approvals') reload('approvals', () => useApprovals.getState().load())
      if (topic === 'prompts') reload('prompts', () => usePrompts.getState().load())
      if (topic === 'chats' && useBots.getState().activeBotId) {
        const botId = useBots.getState().activeBotId!
        reload(`bot-threads:${botId}`, () => useBots.getState().loadThreads(botId))
      }
      if (topic === 'connections') reload('connections', () => useConnections.getState().load())
      if (topic === 'editors' && workspaceId) reload(`editors:${workspaceId}`, () => useEditors.getState().load(workspaceId))
      if ((topic === 'workspaces' || topic === 'agents') && projectId) {
        reload(`ws:${projectId}`, () => useWorkspaces.getState().load(projectId))
      }
      if (topic === 'agents' && workspaceId) reload(`agents:${workspaceId}`, () => useAgents.getState().load(workspaceId))
      if ((topic === 'agents' || topic === 'layout') && workspaceId) {
        reload(`layout:${workspaceId}`, () => useLayouts.getState().load(workspaceId))
      }
    }),
    subscribe('runtime.changed', ({ instanceId, runtime }) => useAgents.getState().setRuntime(instanceId, runtime)),
    subscribe('app.notice', ({ level, message }) => useNotices.getState().push({ level, message })),
    // A routine's notification was clicked: show that run's thread.
    subscribe('bots.open', ({ botId, threadId }) => {
      useNavigation.getState().setMode('bots')
      void useBots.getState().openBotThread(botId, threadId)
    }),
    subscribe('updates.changed', (status) => useUpdates.getState().set(status)),
    subscribe('voice.changed', (packs) => useVoice.getState().setPacks(packs)),
    subscribe('chat.event', ({ chatId, message, summary }) => {
      useChat.getState().applyEvent(chatId, message, summary)
      if (summary.botId) useBots.getState().applyThread(summary)
    }),
    subscribe('browser.changed', (state) => useBrowser.getState().set(state)),
    subscribe('hosts.changed', ({ key, status }) => useHostLinks.getState().set(key, status)),
    subscribe('ssh.prompt', (prompt) => useSshPrompts.getState().add(prompt)),
    subscribe('ssh.promptDone', ({ id }) => useSshPrompts.getState().remove(id))
  ]
  return () => {
    if (timer) clearTimeout(timer)
    offs.forEach((off) => off())
  }
}
