import type { CliInstance, Side } from '@shared/domain'
import { removePane } from '@shared/layout/operations'
import { api } from '../../lib/api'
import { useAgents, useLayouts } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { disposeTerminal } from '../terminal/terminal-registry'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Waits until a just-opened agent can take a message: running, idle for 2 s and
 * something on its screen. A question first (trust this folder?) stops the wait:
 * typing into it would answer it.
 */
export async function waitUntilReady(instanceId: string, timeoutMs = 60_000): Promise<'ready' | 'waiting' | 'stopped' | 'timeout'> {
  const started = Date.now()
  let idleSince: number | null = null
  for (;;) {
    const r = useAgents.getState().runtime[instanceId]
    const now = Date.now()
    if (r?.status === 'waiting-for-you') return 'waiting'
    if (r && !r.running && now - started > 5000) return 'stopped'
    if (r?.running && r.status === 'idle') {
      idleSince ??= now
      if (now - idleSince >= 2000 && now - started >= 3000) {
        const peek = await api('queen.peek', { instanceId }).catch(() => null)
        if (peek?.excerpt) return 'ready'
      }
    } else idleSince = null
    if (now - started > timeoutMs) return 'timeout'
    await sleep(250)
  }
}

/**
 * Agent commands shared by every surface that controls agents. Results are
 * applied to the stores immediately so panes appear/disappear without
 * waiting for the follow-up state events.
 */
export const agentActions = {
  /** Opens an agent; with `resumeSession` it continues that conversation from the CLI's history. */
  /** `chatUi`: chat view or terminal for this agent; absent = the Workspace's or Worktree's default. */
  open: async (workspaceId: string, cliId: string, placement?: { targetPaneId: string; side: Side; asTab?: boolean }, resumeSession?: string, chatUi?: boolean) => {
    const result = await runAction(resumeSession ? 'Resume session' : 'Open agent', () => api('agents.open', { workspaceId, cliId, placement, resumeSession, chatUi }))
    if (!result) return
    useAgents.setState((s) => ({
      byWorkspace: {
        ...s.byWorkspace,
        [workspaceId]: [...(s.byWorkspace[workspaceId] ?? []).filter((a) => a.id !== result.agent.id), result.agent]
      },
      runtime: { ...s.runtime, [result.agent.id]: result.agent.runtime }
    }))
    useLayouts.setState((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: result.layout } }))
    return result.agent
  },

  restart: (instanceId: string) => runAction('Restart agent', () => api('agents.restart', { instanceId })),

  /** Optimistic: the pane leaves at once; on failure the workspace is reloaded from main. */
  close: async (agent: Pick<CliInstance, 'id' | 'workspaceId'>) => {
    const { id, workspaceId } = agent
    useAgents.setState((s) => ({
      byWorkspace: { ...s.byWorkspace, [workspaceId]: (s.byWorkspace[workspaceId] ?? []).filter((a) => a.id !== id) }
    }))
    useLayouts.setState((s) => ({
      byWorkspace: { ...s.byWorkspace, [workspaceId]: removePane(s.byWorkspace[workspaceId] ?? null, id) }
    }))
    const layout = await runAction('Close agent', () => api('agents.close', { instanceId: id }))
    if (layout === undefined) {
      void useAgents.getState().load(workspaceId)
      void useLayouts.getState().load(workspaceId)
      return
    }
    disposeTerminal(id)
  },

  applyPreset: (workspaceId: string, presetId: string) =>
    runAction('Load preset', () => api('agents.applyPreset', { workspaceId, presetId }))
}
