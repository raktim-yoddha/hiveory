import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, CheckCircle2, Lock, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { accountName, BRAIN_PRESETS, presetOf, type BrainAccountView, type BrainKind } from '@shared/queen/brain'
import { Button, IconButton } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { TextField, TextInput } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { api, toAppError } from '../../lib/api'
import { runAction } from '../../stores/notices'
import formStyles from '../../components/ui/form.module.css'
import styles from './Settings.module.css'

const EDITABLE_URL = new Set(['custom', 'ollama', 'lmstudio'])
const KINDS: Array<{ value: BrainKind; label: string }> = [
  { value: 'openai', label: 'OpenAI-compatible' },
  { value: 'anthropic', label: 'Anthropic-compatible' },
  { value: 'gemini', label: 'Gemini' }
]

type TestResult = { ok: boolean; text: string } | 'running'

/**
 * Queen Bee's model providers (ADR 0019): any number of accounts — several per
 * provider — tried in order. The first enabled one plans; when it fails the next
 * takes over. Only requests the built-in rules don't understand ever reach them.
 */
export function QueenProviders() {
  const [accounts, setAccounts] = useState<BrainAccountView[] | null>(null)
  const [editing, setEditing] = useState<BrainAccountView | 'new' | null>(null)
  const [tests, setTests] = useState<Record<string, TestResult>>({})

  useEffect(() => {
    void api('queen.accounts').then(setAccounts, () => setAccounts([]))
  }, [])

  const test = async (id: string): Promise<void> => {
    setTests((t) => ({ ...t, [id]: 'running' }))
    try {
      const r = await api('queen.testAccount', { id })
      setTests((t) => ({ ...t, [id]: { ok: true, text: `${r.detail} ${r.ms} ms` } }))
    } catch (error) {
      setTests((t) => ({ ...t, [id]: { ok: false, text: toAppError(error).message } }))
    }
  }

  const enabled = accounts?.filter((a) => a.enabled) ?? []

  return (
    <>
      <div className={styles.group}>
        <p className={styles.groupNote}>
          Optional. Commands the built-in rules understand never use a model. Anything else goes to the first enabled account below, with project, workspace and agent
          names only — never files, code or terminal output. If it fails, the next one takes over. A model can only choose Queen Bee&apos;s actions, and closing or messaging
          an agent still asks you first.
        </p>
      </div>

      <div className={styles.group}>
        <div className={styles.tabsHeader}>
          <div className={styles.groupTitle}>Accounts</div>
          <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>
            Add provider
          </Button>
        </div>
        {accounts?.length === 0 && <p className={styles.empty}>No provider yet: Queen Bee runs on her built-in rules.</p>}
        {accounts?.map((a, i) => {
          const result = tests[a.id]
          const rank = a.enabled ? enabled.indexOf(a) : -1
          return (
            <div key={a.id} className={styles.listItem}>
              <div className={styles.listMain}>
                <span className={styles.listTitle}>
                  {accountName(a)}{' '}
                  <span className={styles.listMeta}>
                    · {a.model || (presetOf(a.provider).cli ? 'CLI default' : 'no model')} · {rank === 0 ? 'primary' : rank > 0 ? `fallback ${rank}` : 'off'}
                    {!a.hasKey && presetOf(a.provider).keyRequired ? ' · key missing' : ''}
                  </span>
                </span>
                {result && result !== 'running' && (
                  <span className={result.ok ? styles.testOk : styles.testFail} role="status">
                    {result.ok && <CheckCircle2 aria-hidden />}
                    {result.text}
                  </span>
                )}
              </div>
              <span className={styles.inlineControls}>
                <Button size="sm" variant="ghost" loading={result === 'running'} onClick={() => void test(a.id)}>
                  Test
                </Button>
                {i > 0 && (
                  <IconButton
                    label={`Try ${accountName(a)} earlier`}
                    icon={<ArrowUp />}
                    onClick={() => void runAction('Reorder', async () => setAccounts(await api('queen.moveAccount', { id: a.id, to: i - 1 })))}
                  />
                )}
                <IconButton label={`Edit ${accountName(a)}`} icon={<Pencil />} onClick={() => setEditing(a)} />
                <IconButton
                  label={`Remove ${accountName(a)}`}
                  icon={<Trash2 />}
                  onClick={() => void runAction('Remove provider', async () => setAccounts(await api('queen.removeAccount', { id: a.id })))}
                />
                <Toggle
                  label={`Use ${accountName(a)}`}
                  checked={a.enabled}
                  onChange={(on) =>
                    void runAction('Update provider', async () =>
                      setAccounts(await api('queen.saveAccount', { id: a.id, provider: a.provider, label: a.label, kind: a.kind, baseUrl: a.baseUrl, model: a.model, enabled: on }))
                    )
                  }
                />
              </span>
            </div>
          )
        })}
      </div>

      {editing && (
        <AccountDialog
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(list, id) => {
            setAccounts(list)
            setEditing(null)
            if (id) void test(id)
          }}
        />
      )}
    </>
  )
}

/** Add or edit one account: provider, name, address, key, and a model from the provider's own list (or typed). */
function AccountDialog({ account, onClose, onSaved }: { account: BrainAccountView | null; onClose: () => void; onSaved: (list: BrainAccountView[], id?: string) => void }) {
  const [provider, setProvider] = useState(account?.provider ?? 'openai')
  const [label, setLabel] = useState(account?.label ?? '')
  const [kind, setKind] = useState<BrainKind>(account?.kind ?? 'openai')
  const [baseUrl, setBaseUrl] = useState(account?.baseUrl ?? presetOf('openai').baseUrl)
  const [model, setModel] = useState(account?.model ?? presetOf('openai').model)
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[] | null>(null)
  const [listing, setListing] = useState<{ busy: boolean; error?: string }>({ busy: false })
  const [saving, setSaving] = useState(false)
  const preset = presetOf(provider)
  const keptKey = Boolean(account?.hasKey && account.provider === provider)
  const cli = Boolean(preset.cli)

  const choose = (id: string): void => {
    const next = presetOf(id)
    setProvider(id)
    setModels(null)
    setListing({ busy: false })
    if (id !== account?.provider) {
      setBaseUrl(next.baseUrl)
      setModel(next.model)
    }
  }

  const load = async (): Promise<void> => {
    setListing({ busy: true })
    try {
      const list = await api('queen.listModels', { ...(keptKey ? { id: account!.id } : {}), provider, kind, baseUrl, ...(key ? { apiKey: key } : {}) })
      setModels(list)
      setListing({ busy: false, ...(list.length ? {} : { error: 'This provider lists no models. Type the model name.' }) })
    } catch (error) {
      setModels(null)
      setListing({ busy: false, error: toAppError(error).message })
    }
  }

  // Editing an account with a saved key: show its models straight away.
  useEffect(() => {
    if (!account || (!account.hasKey && presetOf(account.provider).keyRequired)) return
    let live = true
    api('queen.listModels', { id: account.id, provider: account.provider, kind: account.kind, baseUrl: account.baseUrl })
      .then((list) => live && setModels(list))
      .catch((error: unknown) => live && setListing({ busy: false, error: toAppError(error).message }))
    return () => {
      live = false
    }
  }, [account])

  const suggestions = useMemo(() => {
    const q = model.trim().toLowerCase()
    return (models ?? []).filter((m) => !q || m.toLowerCase().includes(q)).slice(0, 8)
  }, [models, model])

  const save = async (): Promise<void> => {
    setSaving(true)
    const list = await runAction('Save provider', () =>
      api('queen.saveAccount', { ...(account ? { id: account.id } : {}), provider, label, kind, baseUrl, model, ...(key ? { apiKey: key } : {}) })
    )
    setSaving(false)
    if (!list) return
    const saved = account ? list.find((a) => a.id === account.id) : list.at(-1)
    onSaved(list, saved?.id)
  }

  return (
    <Modal
      open
      title={account ? `Edit ${accountName(account)}` : 'Add provider'}
      onClose={onClose}
      footer={
        <span className={styles.inlineControls}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={(!model.trim() && !cli) || (preset.keyRequired && !key && !keptKey)} onClick={() => void save()}>
            Save and test
          </Button>
        </span>
      }
    >
      <div className={styles.dialogForm}>
        <Select label="Provider" value={provider} options={BRAIN_PRESETS.map((p) => ({ value: p.id, label: p.name }))} onChange={choose} />
        <TextField label="Account name (optional)" value={label} onChange={setLabel} maxLength={40} placeholder="Work, Personal…" />
        {provider === 'custom' && <Select label="API format" value={kind} options={KINDS} onChange={(v) => setKind(v as BrainKind)} />}
        {EDITABLE_URL.has(provider) && <TextField label="Address" value={baseUrl} onChange={setBaseUrl} placeholder={preset.baseUrl || 'https://api.example.com/v1'} />}
        {cli && <CliNote provider={provider} />}
        {!cli && (
          <TextField
            label={preset.keyRequired ? 'API key' : 'API key (optional)'}
            type="password"
            value={key}
            onChange={setKey}
            onBlur={() => key && void load()}
            placeholder={keptKey ? '•••••• saved — leave empty to keep' : 'Paste key'}
          />
        )}
        <div className={styles.modelField}>
          <span className={formStyles.fieldLabel}>{cli ? 'Model (empty uses the CLI default)' : 'Model'}</span>
          <div className={styles.inlineControls}>
            <TextInput aria-label="Model" value={model} onChange={setModel} placeholder={preset.model || (cli ? 'CLI default' : 'model-name')} />
            <Button size="sm" variant="ghost" icon={<RefreshCw className={listing.busy ? 'spin' : undefined} />} onClick={() => void load()}>
              {models ? 'Reload models' : 'Load models'}
            </Button>
          </div>
          {listing.error && <span className={styles.testFail}>{listing.error}</span>}
          {models && models.length > 0 && (
            <div className={styles.modelList} role="listbox" aria-label="Models from the provider">
              {suggestions.map((m) => (
                <button key={m} type="button" role="option" aria-selected={m === model} className={styles.modelOption} onClick={() => setModel(m)}>
                  {m}
                </button>
              ))}
              <span className={styles.listMeta}>
                {models.length} models from {preset.id === 'custom' ? 'this provider' : preset.name}. Not listed? Type its name.
              </span>
            </div>
          )}
        </div>
        {!cli && (
          <p className={styles.groupNote}>
            <Lock aria-hidden className={styles.noteIcon} /> The key is encrypted on this computer and only ever sent to this provider.
          </p>
        )}
      </div>
    </Modal>
  )
}

/** What a subscription brain is, and what it can't do. */
function CliNote({ provider }: { provider: string }) {
  const claude = provider === 'claudecli'
  return (
    <div className={styles.groupNote}>
      <p>
        <Lock aria-hidden className={styles.noteIcon} /> Uses your own {claude ? 'Claude Code' : 'Codex'} CLI, signed in with your {claude ? 'Claude' : 'ChatGPT'} plan.
        Hiveory never reads your login. Each request starts the CLI with no tools, no shell and no settings in an empty folder, so answers take 5–20 seconds.
      </p>
      {claude && (
        <p>
          Anthropic’s terms limit using a Claude subscription through other apps. If you’re unsure it’s allowed for you, use an Anthropic API key instead.
        </p>
      )}
    </div>
  )
}
