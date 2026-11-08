import { useEffect } from 'react'
import { useChat } from '../../stores/chat'
import { useAgents } from '../../stores/data'
import { ChatComposer } from '../chat/ChatComposer'
import { ChatMessages } from '../chat/ChatMessages'
import styles from './AgentPane.module.css'

/**
 * A Work agent in chat view: a conversation and composer,
 * bound to the agent's own chat (its CLI and folder are fixed by the agent).
 */
export function AgentChatView({ instanceId }: { instanceId: string }) {
  const chat = useChat((s) => s.chats[instanceId])
  const load = useChat((s) => s.load)
  // Its worktree: `@` files, the changes it made and its subagents (ADR 0058).
  const agent = useAgents((s) => {
    for (const list of Object.values(s.byWorkspace)) {
      const found = list.find((a) => a.id === instanceId)
      if (found) return found
    }
    return undefined
  })

  useEffect(() => {
    if (!chat) void load(instanceId)
  }, [chat, instanceId, load])

  return (
    <div className={styles.chatView}>
      {chat && (
        <>
          <ChatMessages chat={chat} workspaceId={agent?.workspaceId} />
          <ChatComposer chat={chat} workspaceId={agent?.workspaceId} projectId={agent?.projectId} />
        </>
      )}
    </div>
  )
}
