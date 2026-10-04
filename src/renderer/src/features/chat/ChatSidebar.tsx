import { useEffect } from 'react'
import { MessageSquarePlus, Trash2 } from 'lucide-react'
import { CliLogo } from '../../components/cli/CliLogo'
import { IconButton } from '../../components/ui/Button'
import { StatusDot } from '../../components/ui/StatusDot'
import { cx } from '../../lib/cx'
import { useChat } from '../../stores/chat'
import { useProjects } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import styles from './Chat.module.css'

/** Chat mode's sidebar: every chat, newest first. */
export function ChatSidebar() {
  const { summaries, activeId, loadList, open, create, remove } = useChat()
  const projects = useProjects((s) => s.projects)
  const projectId = useNavigation((s) => selectedProjectId(s.view))

  useEffect(() => {
    void loadList()
  }, [loadList])

  return (
    <nav className={styles.sidebar} aria-label="Chats">
      <div className={styles.sidebarHeader}>
        <h2 className={styles.sidebarHeading}>Chats</h2>
        <IconButton label="New chat" icon={<MessageSquarePlus />} onClick={() => void create(projectId)} />
      </div>
      <ul className={styles.chatList}>
        {summaries.map((chat) => (
          <li key={chat.id} className={styles.chatItem}>
            <button
              type="button"
              className={cx(styles.chatRow, chat.id === activeId && styles.chatActive)}
              onClick={() => void open(chat.id)}
              aria-current={chat.id === activeId ? 'page' : undefined}
            >
              {chat.cliId ? <CliLogo cliId={chat.cliId} size="sm" /> : <span className={styles.chatDot} aria-hidden />}
              <span className={styles.chatText}>
                <span className={styles.chatTitle}>{chat.title}</span>
                <span className={styles.chatMeta}>
                  {projects.find((p) => p.id === chat.projectId)?.name ?? 'Home folder'}
                </span>
              </span>
              {chat.running && <StatusDot status="working" />}
            </button>
            <IconButton className={styles.chatDelete} label={`Delete ${chat.title}`} icon={<Trash2 />} onClick={() => void remove(chat.id)} />
          </li>
        ))}
        {summaries.length === 0 && <li className={styles.sidebarEmpty}>No chats yet.</li>}
      </ul>
    </nav>
  )
}
