import { useEffect } from 'react'
import { CheckCircle2, Download, Lock, Trash2, X } from 'lucide-react'
import { DEFAULT_SHORTCUT, parseShortcut, shortcutLabel } from '@shared/queen/shortcut'
import { packSize, PERSONA_VOICES, SPEECH_LANGUAGES, VOICE_PACKS, type VoicePack, type VoicePackState } from '@shared/queen/voice'
import { Button } from '../../components/ui/Button'
import { RangeField } from '../../components/ui/RangeField'
import { Select } from '../../components/ui/Select'
import { api } from '../../lib/api'
import { usePlatform } from '../../lib/platform'
import { useSettings } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { useVoice } from '../queen/voice'
import { SettingRow } from './SettingsScreen'
import styles from './Settings.module.css'

const size = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`)

/**
 * Queen Bee's voice (ADR 0019 phase 3): a short guide, the speech packs (downloaded
 * only on request, verified against pinned checksums) and how she speaks back.
 */
export function QueenVoiceSettings() {
  const { settings, update } = useSettings()
  const packs = useVoice((s) => s.packs)
  const platform = usePlatform()
  const keys = shortcutLabel(parseShortcut(settings.queenShortcut) ?? parseShortcut(DEFAULT_SHORTCUT)!, platform)
  const listenPack = SPEECH_LANGUAGES.find((l) => l.id === settings.queenSpeechLanguage)?.pack ?? 'parakeet'
  const state = (id: VoicePack['id']): VoicePackState => packs.find((p) => p.id === id) ?? { id, state: 'missing' }

  // Opening the tab re-reads what's installed (packs can change on disk, e.g. removed by hand).
  useEffect(() => {
    void useVoice.getState().load()
  }, [])

  return (
    <>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Get started</div>
        <ol className={styles.steps}>
          <li>
            <strong>Pick your language</strong> below and download its speech pack ({VOICE_PACKS.find((p) => p.id === listenPack)!.name}, {size(packSize(VOICE_PACKS.find((p) => p.id === listenPack)!))}).
          </li>
          <li>
            <strong>Hold {keys}</strong> (or the mic in her bar) and say what you want.
          </li>
          <li>
            <strong>Let go.</strong> She acts, and with Kokoro installed she answers out loud.
          </li>
        </ol>
        <p className={styles.groupNote}>
          <Lock aria-hidden className={styles.noteIcon} /> Your voice never leaves this computer: recognition and speech run locally. Downloads come from fixed addresses and are
          checked against known fingerprints before use.
        </p>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Listening</div>
        <SettingRow
          title="Language you speak"
          description={settings.queenSpeechLanguage === 'hi' ? 'She writes Hindi and Hinglish in English letters and knows common commands (kholo, band karo, dikhao). A model provider handles anything else.' : undefined}
          control={
            <Select
              label="Language you speak"
              hideLabel
              value={settings.queenSpeechLanguage}
              options={SPEECH_LANGUAGES.map((l) => ({ value: l.id, label: l.name }))}
              onChange={(v) => void update({ queenSpeechLanguage: v as typeof settings.queenSpeechLanguage })}
            />
          }
        />
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Speech packs</div>
        {VOICE_PACKS.map((pack) => (
          <PackRow key={pack.id} pack={pack} state={state(pack.id)} needed={pack.id === listenPack || pack.id === 'kokoro'} />
        ))}
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Speaking back</div>
        <SettingRow
          title="Answer out loud"
          description={`${PERSONA_VOICES[settings.queenPersona].name} voice for her current personality. Needs Kokoro.`}
          control={
            <Select
              label="Answer out loud"
              hideLabel
              value={settings.queenSpeak}
              options={[
                { value: 'after-voice', label: 'When I spoke to her' },
                { value: 'always', label: 'Always' },
                { value: 'never', label: 'Never' }
              ]}
              onChange={(v) => void update({ queenSpeak: v as typeof settings.queenSpeak })}
            />
          }
        />
        <RangeField label="Speaking speed" value={settings.queenVoiceSpeed} min={0.8} max={1.4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onCommit={(v) => void update({ queenVoiceSpeed: v })} />
      </div>
    </>
  )
}

function PackRow({ pack, state, needed }: { pack: VoicePack; state: VoicePackState; needed: boolean }) {
  const act = (label: string, run: () => Promise<unknown>) => void runAction(label, run)
  return (
    <div className={styles.listItem}>
      <div className={styles.listMain}>
        <span className={styles.listTitle}>
          {pack.name} <span className={styles.listMeta}>· {pack.kind === 'listen' ? 'listens' : 'speaks'} · {size(packSize(pack))} · {pack.license}</span>
        </span>
        <span className={styles.listDescription}>
          {pack.description} {pack.languages}.
        </span>
        {state.state === 'downloading' && (
          <div className={styles.progress} role="progressbar" aria-label={`${pack.name} download`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor((state.received / state.total) * 100)}>
            <div className={styles.progressBar} style={{ width: `${(state.received / state.total) * 100}%` }} />
          </div>
        )}
        {state.state === 'error' && <span className={styles.testFail}>{state.error}</span>}
      </div>
      {state.state === 'ready' ? (
        <span className={styles.inlineControls}>
          <span className={styles.testOk}>
            <CheckCircle2 aria-hidden /> Ready
          </span>
          <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => act(`Remove ${pack.name}`, () => api('voice.remove', { pack: pack.id }))}>
            Remove
          </Button>
        </span>
      ) : state.state === 'downloading' || state.state === 'verifying' ? (
        <span className={styles.inlineControls}>
          <span className={styles.listMeta}>{state.state === 'verifying' ? 'Unpacking…' : `${Math.floor((state.received / state.total) * 100)}%`}</span>
          <Button size="sm" variant="ghost" icon={<X />} onClick={() => act(`Cancel ${pack.name}`, () => api('voice.cancel', { pack: pack.id }))}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button size="sm" variant={needed ? 'primary' : 'secondary'} icon={<Download />} onClick={() => act(`Download ${pack.name}`, () => api('voice.download', { pack: pack.id }))}>
          {state.state === 'error' ? 'Retry' : 'Download'}
        </Button>
      )}
    </div>
  )
}
