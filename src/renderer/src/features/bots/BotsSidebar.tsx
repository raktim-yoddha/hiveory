import { useEffect, useState } from 'react'
import { Bot as BotIcon, CalendarClock, ChevronDown, LayoutTemplate, ListChecks, Network, Plus, Users, Zap } from 'lucide-react'
import type { BotView } from '@shared/domain/bot'
import { BotAvatar } from '../../components/brand/BotAvatar'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { StatusDot } from '../../components/ui/StatusDot'
import { cx } from '../../lib/cx'
import { useApprovals } from '../../stores/approvals'
import { useBots } from '../../stores/bots'
import { useApp } from '../../stores/data'
import { useBotActions } from './bot-actions'
import { BOT_DRAG_TYPE } from './bot-drag'
import { useBotEditor } from './BotEditor'
import { TeamDialog, useTeamDialog } from './TeamDialog'
import { TemplatesDialog } from './TemplatesDialog'
import chat from '../chat/Chat.module.css'
import styles from './Bots.module.css'

/** Bots mode's sidebar: the bots like a contact list, grouped by team (each Chief first). Right-click a bot for its actions. */
export function BotsSidebar() {
  const { bots, teams, activeBotId, load, select, page, showWorkBoard, showRoutines, showTriggers, showTeamMap } = useBots()
  const waiting = new Set(useApprovals((s) => s.requests).map((r) => r.botId))
  const openEditor = useBotEditor((s) => s.open)
  const openTeam = useTeamDialog((s) => s.open)
  const actions = useBotActions()
  const mac = useApp((s) => s.info?.platform === 'darwin')
  const [templates, setTemplates] = useState(false)
  const [folded, setFolded] = useState<Set<string>>(new Set())

  // New bot: Ctrl N (⌘N), while the bots sidebar is shown. Bots mode has no terminals to take the key from.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 'n' || e.altKey || e.shiftKey || !(mac ? e.metaKey : e.ctrlKey)) return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      useBotEditor.getState().open('new')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mac])

  useEffect(() => {
    void load()
  }, [load])

  const fold = (teamId: string): void =>
    setFolded((f) => {
      const next = new Set(f)
      if (!next.delete(teamId)) next.add(teamId)
      return next
    })

  const row = (bot: BotView) => (
    <li key={bot.id} className={chat.chatItem}>
      <Menu
        context
        label={`${bot.name} actions`}
        items={actions(bot)}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className={cx(chat.chatRow, page === 'bot' && bot.id === activeBotId && chat.chatActive)}
            // Drop it on a calendar hour for a new routine there, or on a team on the team map.
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(BOT_DRAG_TYPE, bot.id)
              e.dataTransfer.effectAllowed = 'copyMove'
            }}
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
              <span className={chat.chatMeta}>{bot.blurb || bot.brief.split('\n')[0] || 'No brief yet'}</span>
            </span>
            {waiting.has(bot.id) ? (
              <StatusDot status="waiting-for-you" detail="Waiting for your yes" />
            ) : (
              bot.running > 0 && <StatusDot status="working" detail={`${bot.running} working`} />
            )}
          </button>
        )}
      />
    </li>
  )

  // One team: a plain list, as before teams. More: a heading per team, each foldable.
  const grouped = teams.length > 1
  return (
    <nav className={chat.sidebar} aria-label="Bots">
      <div className={chat.sidebarHeader}>
        <h2 className={chat.sidebarHeading}>Bots</h2>
        <Menu
          label="New"
          align="end"
          items={[
            { type: 'item', id: 'bot', label: 'New bot', icon: <BotIcon />, hint: mac ? '⌘N' : 'Ctrl N', onSelect: () => openEditor('new') },
            { type: 'item', id: 'team', label: 'Create team', icon: <Users />, onSelect: () => openTeam('new') },
            { type: 'item', id: 'templates', label: 'Templates', icon: <LayoutTemplate />, onSelect: () => setTemplates(true) }
          ]}
          trigger={(props) => <IconButton {...props} label="New bot, team or template" icon={<Plus />} />}
        />
      </div>
      <ul className={chat.chatList}>
        {grouped
          ? teams.map((team) => {
              const members = bots.filter((b) => b.teamId === team.id)
              const open = !folded.has(team.id)
              return (
                <li key={team.id} className={styles.teamGroup}>
                  <button type="button" className={styles.teamHeading} aria-expanded={open} onClick={() => fold(team.id)}>
                    <ChevronDown aria-hidden className={cx(styles.teamChevron, !open && styles.teamFolded)} />
                    <span>{team.name}</span>
                    <span className={styles.teamCount}>{members.length}</span>
                  </button>
                  {open && <ul className={styles.teamList}>{members.length ? members.map(row) : <li className={chat.sidebarEmpty}>No bots yet.</li>}</ul>}
                </li>
              )
            })
          : bots.map(row)}
        {bots.length === 0 && !grouped && <li className={chat.sidebarEmpty}>No bots yet.</li>}
      </ul>
      <div className={styles.sidebarFooter}>
        <button
          type="button"
          className={cx(chat.chatRow, page === 'work' && chat.chatActive)}
          aria-current={page === 'work' ? 'page' : undefined}
          onClick={showWorkBoard}
        >
          <ListChecks aria-hidden className={styles.footerIcon} />
          <span className={chat.chatTitle}>Work board</span>
        </button>
        <button
          type="button"
          className={cx(chat.chatRow, page === 'routines' && chat.chatActive)}
          aria-current={page === 'routines' ? 'page' : undefined}
          onClick={() => showRoutines()}
        >
          <CalendarClock aria-hidden className={styles.footerIcon} />
          <span className={chat.chatTitle}>Routines</span>
        </button>
        <button
          type="button"
          className={cx(chat.chatRow, page === 'triggers' && chat.chatActive)}
          aria-current={page === 'triggers' ? 'page' : undefined}
          onClick={showTriggers}
        >
          <Zap aria-hidden className={styles.footerIcon} />
          <span className={chat.chatTitle}>Triggers</span>
        </button>
        <button
          type="button"
          className={cx(chat.chatRow, page === 'team-map' && chat.chatActive)}
          aria-current={page === 'team-map' ? 'page' : undefined}
          onClick={showTeamMap}
        >
          <Network aria-hidden className={styles.footerIcon} />
          <span className={chat.chatTitle}>Team map</span>
        </button>
      </div>
      <TemplatesDialog
        open={templates}
        onClose={() => setTemplates(false)}
        onPick={(template) => {
          setTemplates(false)
          openEditor('new', template)
        }}
      />
      <TeamDialog />
    </nav>
  )
}
