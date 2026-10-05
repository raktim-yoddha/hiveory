import type { CliInstance, Side } from '@shared/domain'
import { removePane } from '@shared/layout/operations'
import { api } from '../../lib/api'
import { useAgents, useLayouts } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { disposeTerminal } from '../terminal/terminal-registry'

/**
 * Agent commands shared by every surface that controls agents. Results are
 * applied to the stores immediately so panes appear/disappear without
 * waiting for the follow-up state events.
 */
export const agentActions = {
  open: async (workspaceId: string, cliId: string, placement?: { targetPaneId: string; side: Side }) => {
    const result = await runAction('Open agent', () => api('agents.open', { workspaceId, cliId, placement }))
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
