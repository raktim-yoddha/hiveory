import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { AlertTriangle, Check, ExternalLink, KeyRound, Plus, RefreshCw } from 'lucide-react'
import { COMPOSIO, PLUGIN_APPS, type PluginAccount, type PluginApp, type PluginCategory, type PluginStatus } from '@shared/domain'
import { Button, IconButton } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { TextInput } from '../../../components/ui/TextField'
import { api } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import { runAction } from '../../../stores/notices'
import { PluginLogo } from './PluginLogo'
import settings from '../Settings.module.css'
import styles from './Extensions.module.css'

const CATEGORIES: Array<PluginCategory | 'All' | 'Connected'> = ['All', 'Connected', 'Work', 'Code', 'Data', 'Business', 'Search', 'Media']

const STATUS_TEXT: Record<PluginAccount['status'], string> = {
  active: 'active',
  pending: 'waiting for you to approve it in the browser',
  failed: 'failed',
  expired: 'expired'
}

const openUrl = (url: string): void => void api('system.openUrl', { url }).catch(() => undefined)

/**
 * Apps every agent can use — terminal, chat and bots — through the user's own
 * Composio project (ADR 0023): paste the API key once, then Connect goes straight
 * to each app's sign-in. An app can hold several labelled accounts.
 */
export function PluginsPanel() {
  const [status, setStatus] = useState<PluginStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [editingKey, setEditingKey] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  /** The app whose "Add account" label form is open. */
  const [labelFor, setLabelFor] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [disconnecting, setDisconnecting] = useState<PluginAccount | null>(null)
  const [removingKey, setRemovingKey] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All')

  const refresh = useCallback(() => api('plugins.status').then(setStatus).catch(() => undefined), [])
  useEffect(() => {
    void refresh()
    // Coming back from an app's sign-in page in the browser.
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const keySet = Boolean(status?.keySet)
  const byApp = useMemo(() => {
    const map = new Map<string, PluginAccount[]>()
    for (const a of status?.accounts ?? []) map.set(a.appId, [...(map.get(a.appId) ?? []), a])
    return map
  }, [status])
  const isConnected = useCallback((appId: string) => (byApp.get(appId) ?? []).some((a) => a.status === 'active'), [byApp])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PLUGIN_APPS.filter(
      (a) =>
        (category === 'All' || (category === 'Connected' ? byApp.has(a.id) : a.category === category)) &&
        (!q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.category.toLowerCase().includes(q))
    ).sort((a, b) => Number(byApp.has(b.id)) - Number(byApp.has(a.id)))
  }, [query, category, byApp])

  const saveKey = (event: FormEvent): void => {
    event.preventDefault()
    setBusy(COMPOSIO.id)
    void runAction('Save Composio API key', async () => {
      setStatus(await api('plugins.setKey', { apiKey: keyInput }))
      setKeyInput('')
      setEditingKey(false)
    }).finally(() => setBusy(null))
  }

  const connect = (app: PluginApp, accountLabel?: string): void => {
    setBusy(app.id)
    void runAction(`Connect ${app.name}`, async () => {
      await api('plugins.connect', { appId: app.id, ...(accountLabel ? { label: accountLabel } : {}) })
      setLabelFor(null)
      setLabel('')
      await refresh()
    }).finally(() => setBusy(null))
  }

  return (
    <div className={styles.panel}>
      <div className={styles.accountBar}>
        <span className={styles.logoTile} aria-hidden>
          <KeyRound className={styles.keyIcon} />
        </span>
        <div className={styles.setupText}>
          <strong>{keySet ? 'Composio' : 'Connect your apps with Composio'}</strong>
          <span className={styles.hint}>
            {keySet
              ? 'Every agent — terminal, chat and bots — uses the apps you connect below, through your Composio project and plan.'
              : 'Paste your Composio project API key once, free or paid. Then Connect takes you straight to each app’s own sign-in.'}
          </span>
          {(!keySet || editingKey) && (
            <form className={styles.keyForm} onSubmit={saveKey}>
              <TextInput type="password" value={keyInput} onChange={setKeyInput} placeholder="Composio API key" aria-label="Composio API key" autoComplete="off" />
              <Button type="submit" variant="primary" loading={busy === COMPOSIO.id} disabled={keyInput.trim().length < 8}>
                Save key
              </Button>
              {editingKey && (
                <Button variant="ghost" onClick={() => setEditingKey(false)}>
                  Cancel
                </Button>
              )}
            </form>
          )}
          {!keySet && (
            <button type="button" className={styles.linkButton} onClick={() => openUrl(COMPOSIO.keyUrl)}>
              Get your API key from Composio <ExternalLink aria-hidden />
            </button>
          )}
        </div>
        {keySet && !editingKey && (
          <span className={styles.footerEnd}>
            <span className={cx(styles.status, status?.error ? styles.error : styles.ready)}>
              <span className={styles.dot} aria-hidden />
              {status?.error ? 'Error' : 'Key saved'}
            </span>
            <IconButton label="Refresh accounts" icon={<RefreshCw />} onClick={() => void refresh()} />
            <Button size="sm" onClick={() => setEditingKey(true)}>
              Change key
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemovingKey(true)}>
              Remove
            </Button>
          </span>
        )}
      </div>

      {status?.error && (
        <div className={cx(styles.notice, styles.noticeError)}>
          <AlertTriangle aria-hidden />
          <span>{status.error}</span>
        </div>
      )}

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <TextInput value={query} onChange={setQuery} placeholder="Search apps" aria-label="Search apps" />
        </div>
      </div>
      <div className={styles.categories} role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={styles.category} aria-pressed={category === c} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className={settings.empty}>{category === 'Connected' ? 'No apps connected yet.' : 'No apps match.'}</p>}
      <div className={styles.pluginGrid}>
        {shown.map((app, index) => {
          const accounts = byApp.get(app.id) ?? []
          const connected = isConnected(app.id)
          return (
            <section
              key={app.id}
              aria-label={app.name}
              className={cx(styles.pluginCard, styles.stagger, connected && styles.pluginCardOn)}
              style={{ '--i': index } as CSSProperties}
            >
              <span className={styles.pluginTop}>
                <PluginLogo id={app.id} name={app.name} />
                <span className={styles.pluginName}>
                  <strong>{app.name}</strong>
                  <span>{app.category}</span>
                </span>
              </span>
              <span className={styles.description}>{app.description}</span>
              <span className={styles.pluginFoot}>
                {connected ? (
                  <span className={cx(styles.status, styles.ready)}>
                    <Check aria-hidden className={styles.checkIcon} /> Connected
                  </span>
                ) : (
                  <span />
                )}
                {accounts.length ? (
                  <Button size="sm" icon={<Plus />} disabled={!keySet || busy === app.id} onClick={() => setLabelFor(labelFor === app.id ? null : app.id)}>
                    Add account
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" loading={busy === app.id} disabled={!keySet} title={keySet ? undefined : 'Add your Composio API key first'} onClick={() => connect(app)}>
                    Connect
                  </Button>
                )}
              </span>

              {accounts.length > 0 && (
                <ul className={styles.accountList} aria-label={`${app.name} accounts`}>
                  {accounts.map((account) => (
                    <li key={account.id} className={styles.accountRow}>
                      <span className={styles.setupText}>
                        <strong>{account.label || 'Default'}</strong>
                        <span className={styles.hint}>
                          {account.id} · {STATUS_TEXT[account.status]}
                        </span>
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setDisconnecting(account)}>
                        {account.status === 'pending' ? 'Cancel' : 'Disconnect'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {labelFor === app.id && (
                <form
                  className={styles.keyForm}
                  onSubmit={(event) => {
                    event.preventDefault()
                    connect(app, label.trim())
                  }}
                >
                  <TextInput value={label} onChange={setLabel} placeholder="Account label (work, personal…)" aria-label={`${app.name} account label`} maxLength={40} autoFocus />
                  <Button type="submit" loading={busy === app.id} disabled={!label.trim()}>
                    Continue
                  </Button>
                </form>
              )}
            </section>
          )
        })}
      </div>
      <p className={styles.hint}>Need another app? Composio has 1,000+. Ask any agent to use it and it sends you the link to connect it.</p>

      <ConfirmDialog
        open={Boolean(disconnecting)}
        title={`Disconnect ${disconnecting?.label || 'this account'}?`}
        confirmLabel="Disconnect"
        danger
        onClose={() => setDisconnecting(null)}
        onConfirm={() => {
          const target = disconnecting
          setDisconnecting(null)
          if (target) void runAction('Disconnect account', async () => {
            await api('plugins.disconnect', { accountId: target.id })
            await refresh()
          })
        }}
      >
        Agents can no longer use this account. It is removed from your Composio project.
      </ConfirmDialog>
      <ConfirmDialog
        open={removingKey}
        title="Remove the Composio API key?"
        confirmLabel="Remove"
        danger
        onClose={() => setRemovingKey(false)}
        onConfirm={() => {
          setRemovingKey(false)
          void runAction('Remove Composio API key', async () => {
            await api('plugins.removeKey')
            await refresh()
          })
        }}
      >
        Agents lose every app connected through Composio. Your accounts stay in your Composio project and come back when you add the key again.
      </ConfirmDialog>
    </div>
  )
}
