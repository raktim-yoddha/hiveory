import { useEffect } from 'react'
import { preferredChatCli, useChat } from '../../stores/chat'
import { useProjects } from '../../stores/data'
import { agentActions } from './agent-actions'

/**
 * "Chat UI" (ADR 0059): opens a chat in a worktree, on the CLI last picked in a chat (else the first chat
 * CLI installed); its CLI and model are then chosen in its message box. Undefined where there is no chat:
 * no chat CLI installed, or a Workspace on an SSH host (a chat runs its CLI where Hiveory runs).
 */
export function useChatUi(workspaceId: string, projectId: string | undefined): ((placement?: Parameters<typeof agentActions.open>[2]) => void) | undefined {
  const clis = useChat((s) => s.clis)
  const loadClis = useChat((s) => s.loadClis)
  const remote = useProjects((s) => Boolean(s.projects.find((p) => p.id === projectId)?.host))

  useEffect(() => {
    if (!clis.length) void loadClis()
  }, [clis.length, loadClis])

  const cliId = remote ? undefined : preferredChatCli(clis)
  return cliId ? (placement) => void agentActions.open(workspaceId, cliId, placement, undefined, true) : undefined
}
