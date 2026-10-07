import { useState, type DragEvent } from 'react'
import { ArrowRight, Crown, Ellipsis, Network, Pencil, Plus, Trash2 } from 'lucide-react'
import { GENERAL_TEAM, type Team } from '@shared/domain/bot'
import { BotAvatar } from '../../components/brand/BotAvatar'
import { Button, IconButton } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Menu } from '../../components/ui/Menu'
import { StatusDot } from '../../components/ui/StatusDot'
import { cx } from '../../lib/cx'
import { useBots } from '../../stores/bots'
import { useClis } from '../../stores/data'
import { when } from '../routines/routine-text'
import { useBotActions } from './bot-actions'
import { BOT_DRAG_TYPE } from './bot-drag'
import { useHandoffs } from './use-handoffs'
import { useTeamDialog } from './TeamDialog'
import chat from '../chat/Chat.module.css'
import styles from './Bots.module.css'


/**
 * The team map (ADR 0028): one card per team, its Chief first, and the work bots are handing each
 * other. Drag a bot onto another card to move it there (or use "Move to" in its right-click menu).
 */
export function TeamMapPage() {
  const { bots, teams, update, select, openBotThread, deleteTeam } = useBots()
  const openTeam = useTeamDialog((s) => s.open)
  const actions = useBotActions()
  const clis = useClis((s) => s.clis)
  const handoffs = useHandoffs()
  const [over, setOver] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Team | null>(null)

  const name = (botId: string): string => bots.find((b) => b.id === botId)?.name ?? 'A deleted bot'
  const onDrop = (teamId: string) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    setOver(null)
    const botId = e.dataTransfer.getData(BOT_DRAG_TYPE)
    if (botId && bots.find((b) => b.id === botId)?.teamId !== teamId) void update(botId, { teamId })
  }

  return (
    <section className={chat.surface} aria-label="Team map">
      <header className={chat.chatHeader}>
        <Network aria-hidden className={chat.headerIcon} />
        <div className={chat.headerText}>
          <h1 className={chat.chatHeading}>Team map</h1>
          <span className={chat.headerMeta}>
            {bots.length} bot{bots.length === 1 ? '' : 's'} in {teams.length} team{teams.length === 1 ? '' : 's'}. Drag a bot onto another team to move it.
          </span>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => openTeam('new')}>
          Create team
        </Button>
      </header>
      <div className={styles.mapBody}>
        {bots.length === 0 && teams.length === 1 ? (
          <EmptyState icon={<Network />} title="No bots yet" description="Create a bot, then group bots into teams, each with its own Chief of Staff." />
        ) : (
          <div className={styles.teamCards}>
            {teams.map((team) => {
              const members = bots.filter((b) => b.teamId === team.id).sort((a, b) => Number(b.chief) - Number(a.chief))
              return (
                <section
                  key={team.id}
                  className={cx(styles.teamCard, over === team.id && styles.teamCardOver)}
                  aria-label={`${team.name} team`}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(BOT_DRAG_TYPE)) return
                    e.preventDefault()
                    setOver(team.id)
                  }}
                  onDragLeave={() => setOver((o) => (o === team.id ? null : o))}
                  onDrop={onDrop(team.id)}
                >
                  <header className={styles.teamCardHead}>
                    <h2 className={styles.cardTitle}>{team.name}</h2>
                    <span className={styles.teamCount}>{members.length}</span>
                    <Menu
                      label={`${team.name} actions`}
                      align="end"
                      items={[
                        { type: 'item', id: 'rename', label: 'Rename team', icon: <Pencil />, onSelect: () => openTeam(team.id) },
                        ...(team.id === GENERAL_TEAM.id
                          ? []
                          : [{ type: 'item' as const, id: 'delete', label: 'Delete team', icon: <Trash2 />, danger: true, onSelect: () => setDeleting(team) }])
                      ]}
                      trigger={(props) => <IconButton {...props} label={`${team.name} actions`} icon={<Ellipsis />} />}
                    />
                  </header>
                  {members.length === 0 && <p className={styles.switchHint}>No bots yet. Drag one here.</p>}
                  {members.map((bot) => (
                    <Menu
                      key={bot.id}
                      context
                      label={`${bot.name} actions`}
                      items={actions(bot)}
                      trigger={(props) => (
                        <button
                          {...props}
                          type="button"
                          draggable
                          className={styles.botTile}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(BOT_DRAG_TYPE, bot.id)
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onClick={() => void select(bot.id)}
                        >
                          <BotAvatar id={bot.id} name={bot.name} />
                          <span className={chat.chatText}>
                            <span className={cx(chat.chatTitle, styles.nameRow)}>
                              <span>{bot.name}</span>
                              {bot.chief && <Crown aria-label="Chief of Staff" className={styles.crown} />}
                            </span>
                            <span className={chat.chatMeta}>
                              {bot.chief ? 'Chief of Staff' : 'Bot'} · {clis.find((c) => c.id === bot.cliId)?.displayName ?? 'no engine'}
                            </span>
                          </span>
                          {bot.running > 0 && <StatusDot status="working" detail={`${bot.running} working`} />}
                        </button>
                      )}
                    />
                  ))}
                </section>
              )
            })}
          </div>
        )}
        <section className={styles.handoffs} aria-label="Handoffs">
          <h2 className={styles.cardTitle}>Handoffs</h2>
          {handoffs.length === 0 ? (
            <p className={styles.switchHint}>When a Chief hands work to a bot, or a bot asks another, it shows here: going now or in the last day.</p>
          ) : (
            <ul className={styles.handoffList}>
              {handoffs.map((h) => (
                <li key={h.threadId}>
                  <button type="button" className={styles.handoff} onClick={() => void openBotThread(h.toBotId, h.threadId)}>
                    <span className={styles.handoffNames}>
                      {name(h.fromBotId)} <ArrowRight aria-label="to" /> {name(h.toBotId)}
                    </span>
                    <span className={styles.handoffTitle}>{h.title}</span>
                    <span className={cx(styles.handoffState, h.running && styles.handoffRunning)}>{h.running ? 'Working' : `Done · ${when(h.updatedAt)}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'team'}?`}
        confirmLabel="Delete team"
        danger
        onConfirm={() => {
          if (deleting) void deleteTeam(deleting.id)
          setDeleting(null)
        }}
        onClose={() => setDeleting(null)}
      >
        Its bots move to {teams[0]?.name ?? GENERAL_TEAM.name}. Nothing else is deleted.
      </ConfirmDialog>
    </section>
  )
}
