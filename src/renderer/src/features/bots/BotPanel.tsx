import { Monitor, X } from 'lucide-react'
import type { BotView } from '@shared/domain/bot'
import { IconButton } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { useBots } from '../../stores/bots'
import { ComputerTab } from './ComputerTab'
import styles from './Bots.module.css'

// ponytail: one tab today; Routines and Browser join it in the next steps (docs/plans/bots-ui-wiring.md §3).
const TABS = [
  {
    value: 'computer' as const,
    label: 'Computer',
    icon: <Monitor aria-hidden />
  }
]

/** The panel beside a bot's conversation: where it works and what it is doing there. */
export function BotPanel({ bot }: { bot: BotView }) {
  const setPanelOpen = useBots((s) => s.setPanelOpen)
  return (
    <aside className={styles.panel} aria-label={`${bot.name} panel`}>
      <header className={styles.panelHeader}>
        <Tabs label={`${bot.name} panel`} options={TABS} value="computer" onChange={() => undefined} variant="segmented" />
        <IconButton label="Close panel" icon={<X />} onClick={() => setPanelOpen(false)} />
      </header>
      <ComputerTab bot={bot} />
    </aside>
  )
}
