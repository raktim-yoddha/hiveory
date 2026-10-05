import { Cpu, Drama, Keyboard, Mic } from 'lucide-react'
import { Tabs } from '../../components/ui/Tabs'
import { useQueen, type QueenSettingsTab } from '../queen/useQueen'
import { QueenBarSettings } from './QueenBarSettings'
import { QueenPersonality } from './QueenPersonality'
import { QueenProviders } from './QueenProviders'
import { QueenVoiceSettings } from './QueenVoiceSettings'
import { SettingsPage } from './SettingsScreen'
import styles from './Settings.module.css'

/** Queen Bee (ADR 0019): personality, providers, voice, and her bar and shortcut — one tab each. */
export function QueenSection() {
  const tab = useQueen((s) => s.settingsTab)
  const setTab = useQueen((s) => s.setSettingsTab)
  return (
    <SettingsPage
      title="Queen Bee"
      description="Tell her what you want — typed, or spoken while you hold her shortcut — and she opens, closes and finds agents, messages them, switches pages and reports where every agent stands."
    >
      <div className={styles.tabsHeader}>
        <Tabs<QueenSettingsTab>
          label="Queen Bee settings"
          variant="segmented"
          size="lg"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'personality', label: 'Personality', icon: <Drama /> },
            { value: 'providers', label: 'Providers', icon: <Cpu /> },
            { value: 'voice', label: 'Voice', icon: <Mic /> },
            { value: 'bar', label: 'Bar & shortcut', icon: <Keyboard /> }
          ]}
        />
      </div>
      {tab === 'personality' && <QueenPersonality />}
      {tab === 'providers' && <QueenProviders />}
      {tab === 'voice' && <QueenVoiceSettings />}
      {tab === 'bar' && <QueenBarSettings />}
    </SettingsPage>
  )
}
