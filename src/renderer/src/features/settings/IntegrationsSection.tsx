import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { HELP_URLS } from '@shared/domain'
import { CODE_HOST_INFO, CODE_HOSTS, type IntegrationsView } from '@shared/domain/integrations'
import { Button, IconButton } from '../../components/ui/Button'
import { TextInput } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'
import { AppMark } from './extensions/AppMark'
import { SettingsPage } from './SettingsPage'
import settings from './Settings.module.css'
import styles from './Integrations.module.css'

const openUrl = (url: string): void => void api('system.openUrl', { url }).catch(() => undefined)
const [, JIRA_TOKENS, LINEAR_KEYS] = HELP_URLS

/**
 * Settings › Integrations (ADR 0040): the code hosts this computer is signed in to (through their own
 * CLIs, no tokens kept here) and the issue trackers connected with a key. Each Workspace picks its own
 * in its settings; their reviews and issues show in its Dashboard.
 */
export function IntegrationsSection() {
  const [view, setView] = useState<IntegrationsView | null>(null)
  const [checking, setChecking] = useState(false)
  const [open, setOpen] = useState<'jira' | 'linear' | null>(null)

  const check = useCallback(async () => {
    setChecking(true)
    const next = await runAction('Check integrations', () => api('integrations.status', undefined))
    setChecking(false)
    if (next) setView(next)
  }, [])

  useEffect(() => {
    void api('integrations.status', undefined).then(setView, () => undefined)
  }, [])

  const disconnect = (tracker: 'jira' | 'linear'): void => void runAction('Disconnect', () => api('integrations.disconnect', { tracker })).then((next) => next && setView(next))

  return (
    <SettingsPage title="Integrations" description="Where pull requests and issues come from. Each workspace picks its own in its settings, and shows them in its Dashboard.">
      <div className={settings.group}>
        <div className={settings.groupTitle}>Code hosts</div>
        <p className={settings.groupNote}>Through the host&rsquo;s own command-line tool you are signed in to. Hiveory keeps no token for them.</p>
        {CODE_HOSTS.map((id) => {
          const info = CODE_HOST_INFO[id]
          const account = view?.hosts[id]
          return (
            <Service
              key={id}
              id={id}
              name={info.name}
              status={!account ? 'Checking…' : account.available ? `Signed in${account.login ? ` as @${account.login}` : ''} with ${info.cli}` : (account.reason ?? `Install ${info.cli}, then run "${info.signIn}".`)}
              on={account?.available}
              control={<IconButton label={`Check ${info.name} again`} icon={<RefreshCw />} disabled={checking} onClick={() => void check()} />}
            />
          )
        })}
      </div>

      <div className={settings.group}>
        <div className={settings.groupTitle}>Issue trackers</div>
        <p className={settings.groupNote}>Keys stay on this computer, encrypted, and are sent only to that service.</p>
        <Service
          id="jira"
          name="Jira"
          status={view?.jira ? `${view.jira.site.replace('https://', '')} · ${view.jira.email}` : 'Jira Cloud, with your email and an API token.'}
          on={Boolean(view?.jira)}
          control={<ConnectButton connected={Boolean(view?.jira)} open={open === 'jira'} onOpen={() => setOpen('jira')} onDisconnect={() => disconnect('jira')} />}
        >
          {open === 'jira' && <JiraForm onDone={(next) => (setView(next), setOpen(null))} onCancel={() => setOpen(null)} />}
        </Service>
        <Service
          id="linear"
          name="Linear"
          status={view?.linear ? 'Connected' : 'With a personal API key.'}
          on={Boolean(view?.linear)}
          control={<ConnectButton connected={Boolean(view?.linear)} open={open === 'linear'} onOpen={() => setOpen('linear')} onDisconnect={() => disconnect('linear')} />}
        >
          {open === 'linear' && <LinearForm onDone={(next) => (setView(next), setOpen(null))} onCancel={() => setOpen(null)} />}
        </Service>
      </div>
    </SettingsPage>
  )
}

function Service({ id, name, status, on, control, children }: { id: string; name: string; status: string; on?: boolean; control: ReactNode; children?: ReactNode }) {
  return (
    <div className={settings.row}>
      <div className={styles.service}>
        <div className={styles.head}>
          <AppMark id={id} name={name} />
          <div className={settings.rowText}>
            <span className={settings.rowTitle}>{name}</span>
            <span className={settings.rowDescription}>
              {on && <span className={styles.dot} aria-hidden />}
              {status}
            </span>
          </div>
          <div className={settings.rowControl}>{control}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

function ConnectButton({ connected, open, onOpen, onDisconnect }: { connected: boolean; open: boolean; onOpen: () => void; onDisconnect: () => void }) {
  if (connected)
    return (
      <Button size="sm" variant="ghost" onClick={onDisconnect}>
        Disconnect
      </Button>
    )
  return open ? null : (
    <Button size="sm" onClick={onOpen}>
      Connect
    </Button>
  )
}

function JiraForm({ onDone, onCancel }: { onDone: (view: IntegrationsView) => void; onCancel: () => void }) {
  const [site, setSite] = useState('')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setBusy(true)
    void runAction('Connect Jira', () => api('integrations.connectJira', { site, email: email.trim(), token }))
      .then((next) => next && onDone(next))
      .finally(() => setBusy(false))
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <TextInput aria-label="Jira site" placeholder="acme.atlassian.net" value={site} onChange={setSite} autoFocus />
      <TextInput aria-label="Email" type="email" placeholder="Your Atlassian email" value={email} onChange={setEmail} />
      <TextInput aria-label="API token" type="password" placeholder="API token" value={token} onChange={setToken} />
      <Actions busy={busy} disabled={!site.trim() || !email.includes('@') || !token.trim()} onCancel={onCancel} link={{ label: 'Create an API token', url: JIRA_TOKENS }} />
    </form>
  )
}

function LinearForm({ onDone, onCancel }: { onDone: (view: IntegrationsView) => void; onCancel: () => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setBusy(true)
    void runAction('Connect Linear', () => api('integrations.connectLinear', { apiKey: key }))
      .then((next) => next && onDone(next))
      .finally(() => setBusy(false))
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <TextInput aria-label="Linear API key" type="password" placeholder="lin_api_…" value={key} onChange={setKey} autoFocus />
      <Actions busy={busy} disabled={key.trim().length < 8} onCancel={onCancel} link={{ label: 'Create a personal API key', url: LINEAR_KEYS }} />
    </form>
  )
}

function Actions({ busy, disabled, onCancel, link }: { busy: boolean; disabled: boolean; onCancel: () => void; link: { label: string; url: string } }) {
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.link} onClick={() => openUrl(link.url)}>
        {link.label} <ExternalLink aria-hidden />
      </button>
      <span className={styles.spacer} />
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button size="sm" variant="primary" type="submit" loading={busy} disabled={disabled}>
        Connect
      </Button>
    </div>
  )
}
