import { ArrowRightLeft, Crown, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import type { BotView } from '@shared/domain/bot'
import type { MenuEntry } from '../../components/ui/Menu'
import { useBots } from '../../stores/bots'
import { useBotEditor } from './BotEditor'

/** A bot's right-click actions, the same in the sidebar and on the team map. "Move to" is the keyboard way to change teams. */
export function useBotActions(): (bot: BotView) => MenuEntry[] {
  const { teams, update, remove } = useBots()
  const openEditor = useBotEditor((s) => s.open)
  return (bot) => [
    { type: 'item', id: 'edit', label: 'Edit bot', icon: <Pencil />, onSelect: () => openEditor(bot.id) },
    ...(bot.chief ? [] : [{ type: 'item' as const, id: 'chief', label: 'Make Chief of Staff', icon: <Crown />, onSelect: () => void update(bot.id, { chief: true }) }]),
    { type: 'item', id: 'pin', label: bot.pinned ? 'Unpin' : 'Pin to top', icon: bot.pinned ? <PinOff /> : <Pin />, onSelect: () => void update(bot.id, { pinned: !bot.pinned }) },
    ...teams
      .filter((t) => t.id !== bot.teamId)
      .map((t) => ({ type: 'item' as const, id: `move-${t.id}`, label: `Move to ${t.name}`, icon: <ArrowRightLeft />, onSelect: () => void update(bot.id, { teamId: t.id }) })),
    { type: 'separator' },
    { type: 'item', id: 'delete', label: 'Delete bot', icon: <Trash2 />, danger: true, onSelect: () => void remove(bot.id) }
  ]
}
