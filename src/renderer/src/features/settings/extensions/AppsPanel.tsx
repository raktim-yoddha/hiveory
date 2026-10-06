import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { AlertTriangle, Check, ExternalLink, Plus, RefreshCw } from 'lucide-react'
import { COMPOSIO, APPS, type AppAccount, type AppInfo, type AppCategory, type AppsStatus } from '@shared/domain'
import { Button, IconButton } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { TextInput } from '../../../components/ui/TextField'
import { api } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import { runAction } from '../../../stores/notices'
import { AppMark } from './AppMark'
import settings from '../Settings.module.css'
import styles from './Extensions.module.css'

const CATEGORIES: Array<AppCategory | 'All' | 'Connected'> = ['All', 'Connected', 'Work', 'Code', 'Data', 'Business', 'Search', 'Media']

const STATUS_TEXT: Record<AppAccount['status'], string> = {
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
export function AppsPanel() {
  const [status, setStatus] = useState<AppsStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [editingKey, setEditingKey] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  /** The app whose "Add account" label form is open. */
  const [labelFor, setLabelFor] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [disconnecting, setDisconnecting] = useState<AppAccount | null>(null)
  const [removingKey, setRemovingKey] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All')

  const refresh = useCallback(() => api('apps.status').then(setStatus).catch(() => undefined), [])
  useEffect(() => {
    void refresh()
    // Coming back from an app's sign-in page in the browser.
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const keySet = Boolean(status?.keySet)
  const byApp = useMemo(() => {
    const map = new Map<string, AppAccount[]>()
    for (const a of status?.accounts ?? []) map.set(a.appId, [...(map.get(a.appId) ?? []), a])
    return map
  }, [status])
  const isConnected = useCallback((appId: string) => (byApp.get(appId) ?? []).some((a) => a.status === 'active'), [byApp])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return APPS.filter(
      (a) =>
        (category === 'All' || (category === 'Connected' ? byApp.has(a.id) : a.category === category)) &&
        (!q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.category.toLowerCase().includes(q))
    ).sort((a, b) => Number(byApp.has(b.id)) - Number(byApp.has(a.id)))
  }, [query, category, byApp])

  const saveKey = (event: FormEvent): void => {
    event.preventDefault()
    setBusy(COMPOSIO.id)
    void runAction('Save Composio API key', async () => {
      setStatus(await api('apps.setKey', { apiKey: keyInput }))
      setKeyInput('')
      setEditingKey(false)
    }).finally(() => setBusy(null))
  }

  /** Opens the app's sign-in for a new account, named first so several accounts stay apart. */
  const connect = (app: AppInfo, accountLabel: string): void => {
    setBusy(app.id)
    void runAction(`Connect ${app.name}`, async () => {
      await api('apps.connect', { appId: app.id, label: accountLabel })
      setLabelFor(null)
      setLabel('')
      await refresh()
    }).finally(() => setBusy(null))
  }

  return (
    <div className={styles.panel}>
      <div className={styles.accountBar}>
        <AppMark id={COMPOSIO.id} name={COMPOSIO.name} />
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
      <div className={styles.appGrid}>
        {shown.map((app, index) => {
          const accounts = byApp.get(app.id) ?? []
          const connected = isConnected(app.id)
          return (
            <section
              key={app.id}
              aria-label={app.name}
              className={cx(styles.appCard, styles.stagger, connected && styles.appCardOn)}
              style={{ '--i': index } as CSSProperties}
            >
              <span className={styles.appTop}>
                <AppMark id={app.id} name={app.name} />
                <span className={styles.appName}>
                  <strong>{app.name}</strong>
                  <span>{app.category}</span>
                </span>
              </span>
              <span className={styles.description}>{app.description}</span>
              <span className={styles.appFoot}>
                {connected ? (
                  <span className={cx(styles.status, styles.ready)}>
                    <Check aria-hidden className={styles.checkIcon} /> Connected
                  </span>
                ) : (
                  <span />
                )}
                {/* Connect and Add account both ask for the account's name first. */}
                <Button
                  size="sm"
                  variant={accounts.length ? 'secondary' : 'primary'}
                  icon={accounts.length ? <Plus /> : undefined}
                  disabled={!keySet || busy === app.id}
                  title={keySet ? undefined : 'Add your Composio API key first'}
                  aria-expanded={labelFor === app.id}
                  onClick={() => {
                    setLabel('')
                    setLabelFor(labelFor === app.id ? null : app.id)
                  }}
                >
                  {accounts.length ? 'Add account' : 'Connect'}
                </Button>
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
                  <TextInput
                    value={label}
                    onChange={setLabel}
                    placeholder="Account name (work, personal…)"
                    aria-label={`${app.name} account name`}
                    maxLength={40}
                    autoFocus
                    onKeyDown={(event) => event.key === 'Escape' && setLabelFor(null)}
                  />
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
            await api('apps.disconnect', { accountId: target.id })
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
            await api('apps.removeKey')
            await refresh()
          })
        }}
      >
        Agents lose every app connected through Composio. Your accounts stay in your Composio project and come back when you add the key again.
      </ConfirmDialog>
    </div>
  )
}
