import { useEffect, useState } from 'react'
import { CheckCircle2, Lock } from 'lucide-react'
import { BRAIN_PRESETS, type BrainView } from '@shared/queen/brain'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { TextInput } from '../../components/ui/TextField'
import { api, toAppError } from '../../lib/api'
import { runAction } from '../../stores/notices'
import { SettingRow } from './SettingsScreen'
import styles from './Settings.module.css'

const NONE = 'none'
const EDITABLE_URL = new Set(['custom', 'ollama', 'lmstudio'])

/**
 * Queen Bee's optional model (ADR 0019): used only for requests the built-in rules
 * don't understand. The key is write-only: it is sealed in main and never shown again.
 */
export function QueenModelSettings() {
  const [view, setView] = useState<BrainView | null>(null)
  const [provider, setProvider] = useState(NONE)
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const adopt = (v: BrainView): void => {
    setView(v)
    setProvider(v.provider ?? NONE)
    setModel(v.model)
    setBaseUrl(v.baseUrl)
    setKey('')
  }

  useEffect(() => {
    void api('queen.brain').then(adopt, () => undefined)
  }, [])

  const preset = BRAIN_PRESETS.find((p) => p.id === provider)
  const sameProvider = view?.provider === provider
  const dirty = provider !== (view?.provider ?? NONE) || model !== (view?.model ?? '') || baseUrl !== (view?.baseUrl ?? '') || key !== ''
  const needsKey = Boolean(preset?.keyRequired) && !key && !(sameProvider && view?.hasKey)

  const choose = (id: string): void => {
    setProvider(id)
    setTest(null)
    const next = BRAIN_PRESETS.find((p) => p.id === id)
    if (!next) return
    if (id !== view?.provider) {
      setModel(next.model)
      setBaseUrl(next.baseUrl)
    }
  }

  const save = async (): Promise<void> => {
    const saved = await runAction('Save Queen Bee model', () =>
      api('queen.configureBrain', provider === NONE ? { provider: null, baseUrl: '', model: '' } : { provider, baseUrl, model, ...(key ? { apiKey: key } : {}) })
    )
    if (saved) adopt(saved)
  }

  const removeKey = async (): Promise<void> => {
    const saved = await runAction('Remove key', () => api('queen.configureBrain', { provider, baseUrl, model, apiKey: null }))
    if (saved) adopt(saved)
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    try {
      const r = await api('queen.testBrain')
      setTest({ ok: true, text: `${r.detail} ${r.ms} ms.` })
    } catch (error) {
      setTest({ ok: false, text: toAppError(error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>Model</div>
      <p className={styles.groupNote}>
        Optional. Commands the built-in rules understand never use it. Anything else goes to this model with your project, workspace and agent names only. Never files, code or terminal
        output. It can only choose Queen Bee's actions, and anything that closes or messages an agent still asks you first.
      </p>
      <SettingRow
        title="Provider"
        control={
          <Select
            label="Provider"
            hideLabel
            value={provider}
            options={[{ value: NONE, label: 'None (rules only)' }, ...BRAIN_PRESETS.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={choose}
          />
        }
      />
      {provider !== NONE && (
        <>
          <SettingRow
            title="Model"
            description="A fast, cheap model is best: Queen Bee only picks actions."
            control={<TextInput aria-label="Model" placeholder={preset?.model || 'model-name'} value={model} spellCheck={false} onChange={setModel} />}
          />
          {EDITABLE_URL.has(provider) && (
            <SettingRow
              title="Address"
              description="OpenAI-compatible base URL. https, or http on this computer."
              control={<TextInput aria-label="Address" placeholder={preset?.baseUrl || 'https://…/v1'} value={baseUrl} spellCheck={false} onChange={setBaseUrl} />}
            />
          )}
          <SettingRow
            title="API key"
            description={
              sameProvider && view?.hasKey ? (
                <span className={styles.inlineIcon}>
                  <Lock aria-hidden /> Saved{view.encrypted ? ', encrypted by your system keychain' : ''}. Type a new one to replace it.
                </span>
              ) : preset?.keyRequired ? (
                'Stored encrypted on this computer and never shown again.'
              ) : (
                'Optional for local servers.'
              )
            }
            control={
              <div className={styles.inlineControls}>
                <TextInput aria-label="API key" type="password" autoComplete="off" placeholder={sameProvider && view?.hasKey ? '••••••••' : 'Paste key'} value={key} onChange={setKey} />
                {sameProvider && view?.hasKey && (
                  <Button size="sm" variant="ghost" onClick={() => void removeKey()}>
                    Remove
                  </Button>
                )}
              </div>
            }
          />
        </>
      )}
      <div className={styles.inlineControls}>
        <Button size="sm" variant="primary" disabled={!dirty || (provider !== NONE && (!model.trim() || needsKey))} onClick={() => void save()}>
          Save
        </Button>
        {view?.provider && !dirty && (
          <Button size="sm" loading={testing} onClick={() => void runTest()}>
            Test
          </Button>
        )}
        {test && (
          <span className={test.ok ? styles.testOk : styles.testFail} role="status">
            {test.ok && <CheckCircle2 aria-hidden />}
            {test.text}
          </span>
        )}
      </div>
    </div>
  )
}
