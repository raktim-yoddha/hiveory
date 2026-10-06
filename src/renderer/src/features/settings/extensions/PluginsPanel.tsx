import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AlertTriangle, ArrowRight, ExternalLink, LogOut, RefreshCw } from 'lucide-react'
import { COMPOSIO, PLUGIN_APPS, type PluginApp, type PluginCategory } from '@shared/domain'
import { Button, IconButton } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { TextInput } from '../../../components/ui/TextField'
import { api } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import { useConnections } from '../../../stores/connections'
import { runAction } from '../../../stores/notices'
import { ConnectionStatus } from './ConnectionStatus'
import { PluginLogo } from './PluginLogo'
import settings from '../Settings.module.css'
import styles from './Extensions.module.css'

const CATEGORIES: Array<PluginCategory | 'All' | 'Connected'> = ['All', 'Connected', 'Work', 'Code', 'Data', 'Business', 'Search', 'Media']

const openUrl = (url: string): void => void api('system.openUrl', { url }).catch(() => undefined)

/**
 * Apps every agent can use — terminal, chat and bots — through the user's own
 * Composio account (ADR 0023): sign in once, then connect each app on
 * Composio's own page. Hiveory keeps no app keys.
 */
export function PluginsPanel() {
  const connections = useConnections((s) => s.connections)
  const put = useConnections((s) => s.put)
  const account = connections.find((c) => c.pluginId === COMPOSIO.id)
  const signedIn = Boolean(account?.enabled && account.state === 'ready')
  const connected = useMemo(() => new Set(account?.apps ?? []), [account])
  /** Apps whose approval page is open in the browser. */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PLUGIN_APPS.filter(
      (a) =>
        (category === 'All' || (category === 'Connected' ? connected.has(a.id) : a.category === category)) &&
        (!q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.category.toLowerCase().includes(q))
    ).sort((a, b) => Number(connected.has(b.id)) - Number(connected.has(a.id)))
  }, [query, category, connected])

  const signIn = (): void => {
    setBusy(COMPOSIO.id)
    void runAction('Sign in to Composio', async () => put(await api('plugins.signIn'))).finally(() => setBusy(null))
  }

  const markPending = (appId: string, isPending: boolean): void =>
    setPending((s) => {
      const next = new Set(s)
      if (isPending) next.add(appId)
      else next.delete(appId)
      return next
    })

  /** Connects an app, or (once its page is open) asks Composio whether the user approved it. */
  const connect = (app: PluginApp): void => {
    const checking = pending.has(app.id) || connected.has(app.id)
    setBusy(app.id)
    void runAction(checking ? `Check ${app.name}` : `Connect ${app.name}`, async () => {
      const result = await api(checking ? 'plugins.check' : 'plugins.connect', { appId: app.id })
      markPending(app.id, result.state === 'pending')
    }).finally(() => setBusy(null))
  }

  // Coming back from the browser: ask Composio about the apps waiting for approval.
  useEffect(() => {
    if (!pending.size) return
    const onFocus = (): void => {
      for (const appId of pending) {
        void api('plugins.check', { appId })
          .then((result) => markPending(appId, result.state === 'pending'))
          .catch(() => undefined)
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [pending])

  return (
    <div className={styles.panel}>
      <div className={styles.accountBar}>
        <PluginLogo id={COMPOSIO.id} name={COMPOSIO.name} />
        <div className={styles.setupText}>
          <strong>{signedIn ? 'Composio account' : 'Connect your apps with Composio'}</strong>
          <span className={styles.hint}>
            {signedIn
              ? 'Every agent — terminal, chat and bots — uses the apps you connect below. Apps run through Composio’s cloud and your Composio plan.'
              : 'Sign in once with your own Composio account, free or paid. Then connect each app on its own sign-in page — no keys to paste.'}
          </span>
          {!signedIn && (
            <button type="button" className={styles.linkButton} onClick={() => openUrl(COMPOSIO.accountUrl)}>
              No Composio account? Create one <ExternalLink aria-hidden />
            </button>
          )}
        </div>
        <span className={styles.footerEnd}>
          {account && <ConnectionStatus connection={busy === COMPOSIO.id ? { ...account, state: 'connecting' } : account} />}
          {signedIn ? (
            <>
              <IconButton label="Reconnect Composio" icon={<RefreshCw />} onClick={signIn} />
              <IconButton label="Sign out of Composio" icon={<LogOut />} onClick={() => setSigningOut(true)} />
            </>
          ) : (
            <Button variant="primary" loading={busy === COMPOSIO.id} onClick={signIn}>
              Sign in with Composio
            </Button>
          )}
        </span>
      </div>

      {busy === COMPOSIO.id && !signedIn && <p className={styles.hint}>Finish signing in to Composio in your browser, then come back here.</p>}
      {account?.state === 'error' && account.error && (
        <div className={cx(styles.notice, styles.noticeError)}>
          <AlertTriangle aria-hidden />
          <span>{account.error}</span>
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
          const isConnected = connected.has(app.id)
          const isPending = pending.has(app.id)
          return (
            <button
              key={app.id}
              type="button"
              className={cx(styles.pluginCard, styles.stagger, isConnected && styles.pluginCardOn)}
              style={{ '--i': index } as CSSProperties}
              disabled={!signedIn || busy === app.id}
              title={signedIn ? undefined : 'Sign in to Composio first'}
              onClick={() => connect(app)}
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
                {busy === app.id ? (
                  <span className={cx(styles.status, styles.connecting)}>
                    <span className={styles.dot} aria-hidden />
                    {isPending ? 'Checking…' : 'Connecting…'}
                  </span>
                ) : isConnected ? (
                  <span className={cx(styles.status, styles.ready)}>
                    <span className={styles.dot} aria-hidden />
                    Connected
                  </span>
                ) : isPending ? (
                  <span className={cx(styles.status, styles.connecting)}>
                    <span className={styles.dot} aria-hidden />
                    Approve it in your browser · click to check
                  </span>
                ) : (
                  <span className={styles.setUp}>
                    Connect <ArrowRight aria-hidden />
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
      <p className={styles.hint}>
        Need another app? Composio has 1,000+. Ask any agent to use it and it sends you the link to connect it.
      </p>

      <ConfirmDialog
        open={signingOut}
        title="Sign out of Composio?"
        confirmLabel="Sign out"
        danger
        onClose={() => setSigningOut(false)}
        onConfirm={() => {
          setSigningOut(false)
          void runAction('Sign out of Composio', () => api('plugins.signOut'))
        }}
      >
        Agents lose every app connected through Composio, and Hiveory forgets the sign-in. Your apps stay connected in your Composio account.
      </ConfirmDialog>
    </div>
  )
}
