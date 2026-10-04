import { subscribe } from '../lib/api'
import { useAgents, useLayouts, usePresets, useProjects, useSettings, useUpdates, useWorkspaces } from './data'
import { useChat } from './chat'
import { useNotices } from './notices'

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
    subscribe('updates.changed', (status) => useUpdates.getState().set(status)),
    subscribe('chat.event', ({ chatId, message, summary }) => useChat.getState().applyEvent(chatId, message, summary))
  ]
  return () => {
    if (timer) clearTimeout(timer)
    offs.forEach((off) => off())
  }
}
