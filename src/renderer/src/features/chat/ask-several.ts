import { useChat } from '../../stores/chat'
import { agentActions } from '../agents/agent-actions'

/**
 * Asks other CLIs the same thing (ADR 0061 amendment): one new Chat UI per CLI, each to the right of the
 * last, starting beside `besidePaneId`, so the answers read side by side. Text only: attached files belong
 * to the chat they were added to. Returns the chats it opened.
 */
export async function askSeveral(workspaceId: string, besidePaneId: string, cliIds: string[], text: string): Promise<string[]> {
  const opened: string[] = []
  let beside = besidePaneId
  for (const cliId of cliIds) {
    const agent = await agentActions.open(workspaceId, cliId, { targetPaneId: beside, side: 'right' }, undefined, true)
    if (!agent) continue
    opened.push(agent.id)
    beside = agent.id
    await useChat.getState().send(agent.id, text)
  }
  return opened
}
