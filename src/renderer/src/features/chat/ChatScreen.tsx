import { useEffect } from 'react'
import { MessagesSquare } from 'lucide-react'
import { CliLogo } from '../../components/cli/CliLogo'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { useChat } from '../../stores/chat'
import { useClis } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { ChatComposer } from './ChatComposer'
import { ChatMessages } from './ChatMessages'
import styles from './Chat.module.css'

/** Chat mode: a clean conversation over any detected CLI. */
export function ChatScreen() {
  const { activeId, chats, create, loadClis } = useChat()
  const chat = activeId ? chats[activeId] : undefined
  const projectId = useNavigation((s) => selectedProjectId(s.view))
  const cliName = useClis((s) => s.clis.find((c) => c.id === chat?.cliId)?.displayName)

  useEffect(() => {
    void loadClis()
  }, [loadClis])

  if (!chat) {
    return (
      <div className={styles.surface}>
        <EmptyState
          icon={<MessagesSquare />}
          title="Chat with any agent"
          description="Pick a CLI and a model, then just talk. Chats keep running while you work elsewhere."
          actions={
            <Button variant="primary" size="lg" onClick={() => void create(projectId)}>
              New chat
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <section className={styles.surface} aria-label={chat.title}>
      <header className={styles.chatHeader}>
        {chat.cliId ? <CliLogo cliId={chat.cliId} size="lg" /> : <MessagesSquare className={styles.headerIcon} aria-hidden />}
        <div className={styles.headerText}>
          <h1 className={styles.chatHeading}>{chat.title}</h1>
          <span className={styles.headerMeta}>{cliName ?? 'Choose a CLI to begin'}</span>
        </div>
      </header>
      <ChatMessages chat={chat} />
      <ChatComposer chat={chat} />
    </section>
  )
}
