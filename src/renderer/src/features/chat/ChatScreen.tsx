import { useEffect, useState } from 'react'
import { MessagesSquare, Pencil } from 'lucide-react'
import { CliLogo } from '../../components/cli/CliLogo'
import { Button, IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { InlineEdit } from '../../components/ui/InlineEdit'
import { useChat } from '../../stores/chat'
import { useClis } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { ChatComposer } from './ChatComposer'
import { ChatMessages } from './ChatMessages'
import styles from './Chat.module.css'

/** Chat mode: a clean conversation over any detected CLI. */
export function ChatScreen() {
  const { activeId, chats, create, loadClis, rename } = useChat()
  const [renaming, setRenaming] = useState(false)
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
          {renaming ? (
            <InlineEdit
              label="Chat name"
              value={chat.title}
              onCommit={(title) => {
                setRenaming(false)
                void rename(chat.id, title)
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <h1 className={styles.chatHeading} onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
              {chat.title}
            </h1>
          )}
          <span className={styles.headerMeta}>{cliName ?? 'Choose a CLI to begin'}</span>
        </div>
        {!renaming && <IconButton label="Rename chat" icon={<Pencil />} onClick={() => setRenaming(true)} />}
      </header>
      <ChatMessages chat={chat} />
      <ChatComposer chat={chat} />
    </section>
  )
}
