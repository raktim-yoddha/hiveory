import { useEffect } from 'react'
import { CalendarClock, Crown, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import { BotAvatar } from '../../components/brand/BotAvatar'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { StatusDot } from '../../components/ui/StatusDot'
import { cx } from '../../lib/cx'
import { useBots } from '../../stores/bots'
import { useBotEditor } from './BotEditor'
import chat from '../chat/Chat.module.css'
import styles from './Bots.module.css'

/** Bots mode's sidebar: the team like a contact list, the Chief of Staff first. Right-click a bot for its actions. */
export function BotsSidebar() {
  const { bots, activeBotId, load, select, update, remove, page, showRoutines } = useBots()
  const openEditor = useBotEditor((s) => s.open)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <nav className={chat.sidebar} aria-label="Bots">
      <div className={chat.sidebarHeader}>
        <h2 className={chat.sidebarHeading}>Bots</h2>
        <IconButton label="New bot" icon={<Plus />} onClick={() => openEditor('new')} />
      </div>
      <ul className={chat.chatList}>
        {bots.map((bot) => (
          <li key={bot.id} className={chat.chatItem}>
            <Menu
              context
              label={`${bot.name} actions`}
              items={[
                { type: 'item', id: 'edit', label: 'Edit bot', icon: <Pencil />, onSelect: () => openEditor(bot.id) },
                ...(bot.chief ? [] : [{ type: 'item' as const, id: 'chief', label: 'Make Chief of Staff', icon: <Crown />, onSelect: () => void update(bot.id, { chief: true }) }]),
                {
                  type: 'item',
                  id: 'pin',
                  label: bot.pinned ? 'Unpin' : 'Pin to top',
                  icon: bot.pinned ? <PinOff /> : <Pin />,
                  onSelect: () => void update(bot.id, { pinned: !bot.pinned })
                },
                { type: 'separator' },
                { type: 'item', id: 'delete', label: 'Delete bot', icon: <Trash2 />, danger: true, onSelect: () => void remove(bot.id) }
              ]}
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  className={cx(chat.chatRow, page === 'bot' && bot.id === activeBotId && chat.chatActive)}
                  onClick={() => void select(bot.id)}
                  onDoubleClick={() => openEditor(bot.id)}
                  aria-current={page === 'bot' && bot.id === activeBotId ? 'page' : undefined}
                >
                  <BotAvatar id={bot.id} name={bot.name} size="sm" />
                  <span className={chat.chatText}>
                    <span className={cx(chat.chatTitle, styles.nameRow)}>
                      <span>{bot.name}</span>
                      {bot.chief && <span className={styles.badge}>Chief</span>}
                    </span>
                    <span className={chat.chatMeta}>{bot.brief.split('\n')[0] || 'No brief yet'}</span>
                  </span>
                  {bot.running > 0 && <StatusDot status="working" detail={`${bot.running} working`} />}
                </button>
              )}
            />
          </li>
        ))}
        {bots.length === 0 && <li className={chat.sidebarEmpty}>No bots yet.</li>}
      </ul>
      <div className={styles.sidebarFooter}>
        <button
          type="button"
          className={cx(chat.chatRow, page === 'routines' && chat.chatActive)}
          aria-current={page === 'routines' ? 'page' : undefined}
          onClick={() => showRoutines()}
        >
          <CalendarClock aria-hidden className={styles.footerIcon} />
          <span className={chat.chatTitle}>Routines</span>
        </button>
      </div>
    </nav>
  )
}
