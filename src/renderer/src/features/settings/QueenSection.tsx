import { useState } from 'react'
import { doneLine, PERSONAS, type PersonaId, type QueenPrefs } from '@shared/queen/personas'
import { Select } from '../../components/ui/Select'
import { TextInput } from '../../components/ui/TextField'
import { useSettings } from '../../stores/data'
import { useQueen } from '../queen/useQueen'
import { QueenModelSettings } from './QueenModelSettings'
import { SettingRow, SettingsPage } from './SettingsScreen'
import styles from './Settings.module.css'

const SAMPLE = [{ kind: 'opened' as const, count: 2, cliName: 'Codex', workspace: 'feature-x' }]

/** Queen Bee (ADR 0019): personality, how she talks to you, and where she sits. */
export function QueenSection() {
  const { settings, update } = useSettings()
  const placement = useQueen((s) => s.placement)
  const setPlacement = useQueen((s) => s.setPlacement)
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
    <SettingsPage
      title="Queen Bee"
      description="Type what you want (Ctrl Shift K) and she opens, closes and finds agents, switches pages and tells you where every agent stands. Her personality only changes how she talks, never what she does."
    >
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

      <QueenModelSettings />

      <div className={styles.group}>
        <div className={styles.groupTitle}>Placement</div>
        <SettingRow
          title="Where she sits"
          description="Docked sits under the main area and lifts it up. Floating can be dragged anywhere by her mark."
          control={
            <Select
              label="Where she sits"
              hideLabel
              value={placement}
              options={[
                { value: 'docked', label: 'Docked' },
                { value: 'floating', label: 'Floating' }
              ]}
              onChange={(v) => setPlacement(v as 'docked' | 'floating')}
            />
          }
        />
      </div>
    </SettingsPage>
  )
}
