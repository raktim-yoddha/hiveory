import { useState } from 'react'
import { doneLine, PERSONAS, type PersonaId, type QueenPrefs } from '@shared/queen/personas'
import { Select } from '../../components/ui/Select'
import { TextInput } from '../../components/ui/TextField'
import { useSettings } from '../../stores/data'
import { Cpu, Drama, Keyboard, Mic } from 'lucide-react'
import { Tabs } from '../../components/ui/Tabs'
import { useQueen, type QueenSettingsTab } from '../queen/useQueen'
import { QueenBarSettings } from './QueenBarSettings'
import { QueenProviders } from './QueenProviders'
import { QueenVoiceSettings } from './QueenVoiceSettings'
import { SettingRow, SettingsPage } from './SettingsScreen'
import styles from './Settings.module.css'

const SAMPLE = [{ kind: 'opened' as const, count: 2, cliName: 'Codex', workspace: 'feature-x' }]

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
      {tab === 'personality' && <PersonalityTab />}
      {tab === 'providers' && <QueenProviders />}
      {tab === 'voice' && <QueenVoiceSettings />}
      {tab === 'bar' && <QueenBarSettings />}
    </SettingsPage>
  )
}

/** Who she is and how she addresses you. Her personality changes wording only, never what she does. */
function PersonalityTab() {
  const { settings, update } = useSettings()
  const [callMe, setCallMe] = useState<string | null>(null)
  const prefs: QueenPrefs = {
    persona: settings.queenPersona,
    callMe: settings.queenCallMe,
    honorific: settings.queenHonorific,
    hype: settings.queenHype,
    nudgeMinutes: settings.queenNudgeMinutes,
    length: settings.queenLength
  }

  return (
    <>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Personality</div>
        <div className={styles.personas} role="radiogroup" aria-label="Personality">
          {(Object.keys(PERSONAS) as PersonaId[]).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.queenPersona === id}
              className={styles.persona}
              onClick={() => void update({ queenPersona: id })}
            >
              <span className={styles.personaName}>{PERSONAS[id].name}</span>
              <span className={styles.personaTagline}>{PERSONAS[id].tagline}</span>
              <span className={styles.personaSample}>“{doneLine(SAMPLE, { ...prefs, persona: id })}”</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>How she talks to you</div>
        <SettingRow
          title="What she calls you"
          description="Used in reports and nudges. Leave empty for none."
          control={
            <TextInput
              aria-label="What she calls you"
              placeholder="Your name"
              maxLength={40}
              value={callMe ?? settings.queenCallMe}
              onChange={setCallMe}
              onBlur={() => {
                if (callMe !== null && callMe.trim() !== settings.queenCallMe) void update({ queenCallMe: callMe.trim() })
                setCallMe(null)
              }}
            />
          }
        />
        <SettingRow
          title="Reply length"
          control={
            <Select
              label="Reply length"
              hideLabel
              value={settings.queenLength}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'short', label: 'Short' }
              ]}
              onChange={(v) => void update({ queenLength: v as QueenPrefs['length'] })}
            />
          }
        />
        {settings.queenPersona === 'ada' && (
          <SettingRow
            title="How Ada addresses you"
            control={
              <Select
                label="How Ada addresses you"
                hideLabel
                value={settings.queenHonorific}
                options={[
                  { value: 'none', label: 'No title' },
                  { value: 'sir', label: 'Sir' },
                  { value: 'maam', label: 'Ma’am' },
                  { value: 'name', label: 'By name' }
                ]}
                onChange={(v) => void update({ queenHonorific: v as QueenPrefs['honorific'] })}
              />
            }
          />
        )}
        {settings.queenPersona === 'sunny' && (
          <SettingRow
            title="Sunny’s energy"
            control={
              <Select
                label="Sunny’s energy"
                hideLabel
                value={settings.queenHype}
                options={[
                  { value: 'calm', label: 'Calm' },
                  { value: 'lively', label: 'Lively' },
                  { value: 'max', label: 'Maximum' }
                ]}
                onChange={(v) => void update({ queenHype: v as QueenPrefs['hype'] })}
              />
            }
          />
        )}
        {settings.queenPersona === 'frankie' && (
          <SettingRow
            title="Call out waiting agents after"
            description="Frankie flags an agent that has waited on you this long."
            control={
              <Select
                label="Call out waiting agents after"
                hideLabel
                value={String(settings.queenNudgeMinutes)}
                options={[
                  { value: '0', label: 'Never' },
                  { value: '5', label: '5 minutes' },
                  { value: '10', label: '10 minutes' },
                  { value: '15', label: '15 minutes' },
                  { value: '30', label: '30 minutes' }
                ]}
                onChange={(v) => void update({ queenNudgeMinutes: Number(v) })}
              />
            }
          />
        )}
      </div>

    </>
  )
}
