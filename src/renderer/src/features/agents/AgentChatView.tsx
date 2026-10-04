import { useEffect } from 'react'
import { useChat } from '../../stores/chat'
import { ChatComposer } from '../chat/ChatComposer'
import { ChatMessages } from '../chat/ChatMessages'
import styles from './AgentPane.module.css'

/**
 * A Work agent in chat view: the same conversation and composer as Chat mode,
 * bound to the agent's own chat (its CLI and folder are fixed by the agent).
 */
export function AgentChatView({ instanceId }: { instanceId: string }) {
  const chat = useChat((s) => s.chats[instanceId])
  const load = useChat((s) => s.load)

  useEffect(() => {
    if (!chat) void load(instanceId)
  }, [chat, instanceId, load])

  return (
    <div className={styles.chatView}>
      {chat && (
        <>
          <ChatMessages chat={chat} />
          <ChatComposer chat={chat} agent />
        </>
      )}
    </div>
  )
}
