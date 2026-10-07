import type { ReactNode } from 'react'
import { CalendarClock, Globe, LayoutGrid, Monitor, X } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { useBots, type BotPanelTab } from '../../stores/bots'
import { BrowserTab } from './BrowserTab'
import { ComputerTab } from './ComputerTab'
import { OverviewTab } from './OverviewTab'
import { RoutinesTab } from './RoutinesTab'
import styles from './Bots.module.css'

const TABS: Array<{ value: BotPanelTab; label: string; icon: ReactNode }> = [
  { value: 'overview', label: 'Overview', icon: <LayoutGrid aria-hidden /> },
  { value: 'computer', label: 'Computer', icon: <Monitor aria-hidden /> },
  { value: 'routines', label: 'Routines', icon: <CalendarClock aria-hidden /> },
  { value: 'browser', label: 'Browser', icon: <Globe aria-hidden /> }
]

/** The right column in Bots mode: where the open bot works, and its browser. */
export function BotPanel() {
  const { bots, activeBotId, panelTab, setPanelTab, setPanelOpen } = useBots()
  const bot = bots.find((b) => b.id === activeBotId)
  if (!bot) return null
  return (
    <aside className={styles.panel} aria-label={`${bot.name} panel`}>
      <header className={styles.panelHeader}>
        <Tabs label={`${bot.name} panel`} options={TABS} value={panelTab} onChange={setPanelTab} variant="segmented" />
        <IconButton label="Close panel" icon={<X />} onClick={() => setPanelOpen(false)} />
      </header>
      {panelTab === 'overview' ? (
        <OverviewTab bot={bot} />
      ) : panelTab === 'computer' ? (
        <ComputerTab bot={bot} />
      ) : panelTab === 'routines' ? (
        <RoutinesTab bot={bot} />
      ) : (
        <BrowserTab bot={bot} />
      )}
    </aside>
  )
}
