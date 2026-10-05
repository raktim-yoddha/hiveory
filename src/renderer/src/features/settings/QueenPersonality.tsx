import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { AppSettings } from '@shared/domain'
import { MAX_NOTE_LENGTH, MAX_NOTES } from '@shared/queen/actions'
import { customNameProblem, doneLine, PERSONAS, prefsFromSettings, type PersonaId, type QueenPrefs } from '@shared/queen/personas'
import { Button, IconButton } from '../../components/ui/Button'
import { InlineEdit } from '../../components/ui/InlineEdit'
import { RangeField } from '../../components/ui/RangeField'
import { Select } from '../../components/ui/Select'
import { TextAreaField, TextInput } from '../../components/ui/TextField'
import { useSettings } from '../../stores/data'
import { SettingRow } from './SettingsScreen'
import styles from './Settings.module.css'

const SAMPLE = [{ kind: 'opened' as const, count: 2, cliName: 'Codex', workspace: 'feature-x' }]

/** A text setting saved when the field loses focus (not on every keystroke). */
function DraftInput({ label, value, onSave, placeholder, maxLength, check }: { label: string; value: string; onSave: (v: string) => void; placeholder?: string; maxLength: number; check?: (v: string) => string | null }) {
  const [draft, setDraft] = useState<string | null>(null)
  const problem = draft !== null && check ? check(draft) : null
  return (
    <span className={styles.draftField}>
      <TextInput
        aria-label={label}
        aria-invalid={Boolean(problem)}
        placeholder={placeholder}
        maxLength={maxLength}
        value={draft ?? value}
        onChange={setDraft}
        onBlur={() => {
          if (draft !== null && !problem && draft.trim() !== value) onSave(draft.trim())
          setDraft(null)
        }}
      />
      {problem && (
        <span className={styles.testFail} role="alert">
          {problem}
        </span>
      )}
    </span>
  )
}

const tone = (low: string, high: string) => (v: number) => (v < 34 ? low : v < 67 ? 'Balanced' : high)

/** Who she is and how she addresses you. Her personality changes wording only, never what she does. */
export function QueenPersonality() {
  const { settings, update } = useSettings()
  const prefs: QueenPrefs = prefsFromSettings(settings)
  const save = (patch: Partial<AppSettings>) => void update(patch)
  const persona = settings.queenPersona
  const name = (id: PersonaId) => (id === 'custom' ? settings.queenCustomName : PERSONAS[id].name)

  return (
    <>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Personality</div>
        <div className={styles.personas} role="radiogroup" aria-label="Personality">
          {(Object.keys(PERSONAS) as PersonaId[]).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={persona === id} className={styles.persona} onClick={() => save({ queenPersona: id })}>
              <span className={styles.personaName}>{name(id)}</span>
              <span className={styles.personaTagline}>{PERSONAS[id].tagline}</span>
              <span className={styles.personaSample}>“{doneLine(SAMPLE, { ...prefs, persona: id })}”</span>
            </button>
          ))}
        </div>
      </div>

      {persona === 'custom' && (
        <div className={styles.group}>
          <div className={styles.groupTitle}>Your personality</div>
          <SettingRow
            title="Her name"
            description={`She answers to it (“${settings.queenCustomName}, open Codex”). Agent names are not allowed.`}
            control={<DraftInput label="Her name" value={settings.queenCustomName} maxLength={20} check={customNameProblem} onSave={(v) => save({ queenCustomName: v })} />}
          />
          <div className={styles.fieldBlock}>
            <CustomStyle value={settings.queenCustomPersona} onSave={(v) => save({ queenCustomPersona: v })} />
          </div>
          <div className={styles.sliders}>
            <RangeField label="Formal or casual" value={settings.queenCustomFormal} min={0} max={100} step={1} format={tone('Casual', 'Formal')} onCommit={(v) => save({ queenCustomFormal: v })} />
            <RangeField label="Calm or energetic" value={settings.queenCustomEnergy} min={0} max={100} step={1} format={tone('Calm', 'Energetic')} onCommit={(v) => save({ queenCustomEnergy: v })} />
            <RangeField label="Gentle or direct" value={settings.queenCustomDirect} min={0} max={100} step={1} format={tone('Gentle', 'Direct')} onCommit={(v) => save({ queenCustomDirect: v })} />
          </div>
          <p className={styles.groupNote}>
            Her instant replies follow the slider you push furthest. The style text only shapes what a model provider writes, and never changes what she is allowed to do.
          </p>
        </div>
      )}

      <div className={styles.group}>
        <div className={styles.groupTitle}>How she talks to you</div>
        <SettingRow
          title="What she calls you"
          description="Used in reports and nudges. Leave empty for none."
          control={<DraftInput label="What she calls you" placeholder="Your name" value={settings.queenCallMe} maxLength={40} onSave={(v) => save({ queenCallMe: v })} />}
        />
        {settings.queenCallMe && (
          <SettingRow
            title="Say it as"
            description="How your name sounds when she speaks, spelled the way it’s said (e.g. “Rock-team”)."
            control={<DraftInput label="Say it as" placeholder={settings.queenCallMe} value={settings.queenCallMeSay} maxLength={60} onSave={(v) => save({ queenCallMeSay: v })} />}
          />
        )}
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
              onChange={(v) => save({ queenLength: v as QueenPrefs['length'] })}
            />
          }
        />
        {(persona === 'ada' || persona === 'custom') && (
          <SettingRow
            title={`How ${name(persona)} addresses you`}
            control={
              <Select
                label="How she addresses you"
                hideLabel
                value={settings.queenHonorific}
                options={[
                  { value: 'none', label: 'No title' },
                  { value: 'sir', label: 'Sir' },
                  { value: 'maam', label: 'Ma’am' },
                  { value: 'name', label: 'By name' }
                ]}
                onChange={(v) => save({ queenHonorific: v as QueenPrefs['honorific'] })}
              />
            }
          />
        )}
        {persona === 'sunny' && (
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
                onChange={(v) => save({ queenHype: v as QueenPrefs['hype'] })}
              />
            }
          />
        )}
        {persona === 'frankie' && (
          <>
            <SettingRow
              title="Your goal"
              description="Frankie keeps you honest about it in every report. Include the deadline."
              control={<DraftInput label="Your goal" placeholder="Ship the beta by Friday" value={settings.queenGoal} maxLength={200} onSave={(v) => save({ queenGoal: v })} />}
            />
            <SettingRow
              title="How hard she pushes"
              control={
                <Select
                  label="How hard she pushes"
                  hideLabel
                  value={settings.queenIntensity}
                  options={[
                    { value: 'steady', label: 'Steady' },
                    { value: 'hard', label: 'Hard' }
                  ]}
                  onChange={(v) => save({ queenIntensity: v as 'steady' | 'hard' })}
                />
              }
            />
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
                  onChange={(v) => save({ queenNudgeMinutes: Number(v) })}
                />
              }
            />
          </>
        )}
      </div>

      <LearnedNotes notes={settings.queenMemory} onChange={(next) => save({ queenMemory: next })} />
    </>
  )
}

function CustomStyle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <TextAreaField
      label="How she comes across (optional)"
      placeholder="Warm and witty, keeps it short, cheers me on when tests pass."
      maxLength={500}
      value={draft ?? value}
      onChange={setDraft}
      onBlur={() => {
        if (draft !== null && draft.trim() !== value) onSave(draft.trim())
        setDraft(null)
      }}
    />
  )
}

/** Things she's learned: only what you asked her to remember. Editable, local only. */
function LearnedNotes({ notes, onChange }: { notes: string[]; onChange: (next: string[]) => void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const text = draft.trim()
    if (!text || notes.some((n) => n.toLowerCase() === text.toLowerCase())) return
    onChange([...notes, text])
    setDraft('')
  }
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>Things she’s learned</div>
      <p className={styles.groupNote}>
        Say “remember that I review with Claude” and she notes it here (“Noted: …”). Notes stay on this computer; with a model provider they are sent along as facts, never as
        instructions. “What do you know about me?” reads them back, “forget …” removes one.
      </p>
      {notes.length === 0 && <p className={styles.empty}>Nothing yet.</p>}
      {notes.map((note, i) => (
        <div key={note} className={styles.listItem}>
          <div className={styles.listMain}>
            {editing === i ? (
              <InlineEdit
                value={note}
                label="Edit note"
                maxLength={MAX_NOTE_LENGTH}
                onCommit={(next) => {
                  onChange(notes.map((n, k) => (k === i ? next : n)))
                  setEditing(null)
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <span className={styles.listDescription}>{note}</span>
            )}
          </div>
          <span className={styles.inlineControls}>
            <IconButton label={`Edit note: ${note}`} icon={<Pencil />} onClick={() => setEditing(i)} />
            <IconButton label={`Remove note: ${note}`} icon={<Trash2 />} onClick={() => onChange(notes.filter((_, k) => k !== i))} />
          </span>
        </div>
      ))}
      {notes.length < MAX_NOTES && (
        <div className={styles.inlineForm}>
          <TextInput
            aria-label="New note"
            placeholder="Add a note, e.g. I review pull requests with Claude"
            maxLength={MAX_NOTE_LENGTH}
            value={draft}
            onChange={setDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
          <Button size="sm" icon={<Plus />} disabled={!draft.trim()} onClick={add}>
            Add
          </Button>
        </div>
      )}
    </div>
  )
}
