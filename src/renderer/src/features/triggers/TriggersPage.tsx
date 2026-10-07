import { useEffect, useState } from 'react'
import { ArrowRight, ExternalLink, Link2, Trash2, Zap } from 'lucide-react'
import { appById, type AppsStatus } from '@shared/domain/apps'
import { MAX_TRIGGER_PROMPT, type TriggerField } from '@shared/domain/trigger'
import { Button, IconButton } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Select } from '../../components/ui/Select'
import { TextAreaField, TextField } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { useBots } from '../../stores/bots'
import { useNavigation } from '../../stores/navigation'
import { useTriggers } from '../../stores/triggers'
import { when } from '../routines/routine-text'
import chat from '../chat/Chat.module.css'
import styles from './Triggers.module.css'

type Values = Record<string, string | boolean>

/** The fields' values as Composio expects them: numbers as numbers, empty optional fields left out. */
const configOf = (fields: TriggerField[], values: Values): Record<string, string | number | boolean> =>
  Object.fromEntries(
    fields.flatMap((f): Array<[string, string | number | boolean]> => {
      const v = values[f.key] ?? f.default ?? (f.type === 'boolean' ? false : '')
      if (f.type === 'boolean') return [[f.key, Boolean(v)]]
      if (v === '') return []
      return [[f.key, f.type === 'number' ? Number(v) : String(v)]]
    })
  )

/** Triggers (ADR 0028): start a bot's work the moment something happens in a connected app. */
export function TriggersPage() {
  const { link, triggers, types, loaded, load, loadTypes, enableLink, disableLink, create, update, remove } = useTriggers()
  const { bots } = useBots()
  const openSettings = useNavigation((s) => s.openSettings)
  const [apps, setApps] = useState<AppsStatus | null>(null)
  const [accountId, setAccountId] = useState('')
  const [slug, setSlug] = useState('')
  const [botId, setBotId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [values, setValues] = useState<Values>({})
  const [deleting, setDeleting] = useState<string | null>(null)
  const [takingOver, setTakingOver] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
    void api('apps.status').then(setApps, () => setApps({ keySet: false, accounts: [] }))
  }, [loaded, load])

  const accounts = (apps?.accounts ?? []).filter((a) => a.status === 'active')
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const appTypes = account ? types[account.appId] : undefined
  useEffect(() => {
    if (account) void loadTypes(account.appId)
  }, [account, loadTypes])
  const type = appTypes?.find((t) => t.slug === slug) ?? appTypes?.[0]
  const bot = bots.find((b) => b.id === botId) ?? bots[0]
  const missing = type?.fields.filter((f) => f.required && f.type !== 'boolean' && !String(values[f.key] ?? f.default ?? '').trim()) ?? []

  const submit = async (): Promise<void> => {
    if (!account || !type || !bot || missing.length) return
    const made = await create({
      name: type.name,
      botId: bot.id,
      prompt: prompt.trim(),
      appId: account.appId,
      accountId: account.id,
      triggerSlug: type.slug,
      triggerName: type.name,
      config: configOf(type.fields, values)
    })
    if (made) {
      setPrompt('')
      setValues({})
    }
  }

  const appName = (appId: string): string => appById(appId)?.name ?? appId
  const botName = (id: string): string => bots.find((b) => b.id === id)?.name ?? 'A deleted bot'

  return (
    <section className={chat.surface} aria-label="Triggers">
      <header className={chat.chatHeader}>
        <Zap aria-hidden className={chat.headerIcon} />
        <div className={chat.headerText}>
          <h1 className={chat.chatHeading}>Triggers</h1>
          <span className={chat.headerMeta}>Start a bot&rsquo;s work the moment something happens in your apps, without asking.</span>
        </div>
      </header>
      <div className={styles.body}>
        <section className={styles.card} aria-label="Event link">
          <div className={styles.row}>
            <Link2 aria-hidden className={styles.icon} />
            <div className={styles.text}>
              <strong>Event link {link.state === 'on' ? 'on' : link.state === 'error' ? 'needs attention' : 'off'}</strong>
              <span className={styles.hint}>
                {link.state === 'on'
                  ? `Events arrive at ${link.url}. Only this path is public, and every event is checked against Composio's signature.`
                  : 'Composio delivers events to a public HTTPS link. Hiveory publishes one random path of this computer with Tailscale Funnel, checks every event, and runs it read-only.'}
              </span>
              {link.state === 'error' && <span className={styles.problem}>{link.detail}</span>}
            </div>
            {link.state === 'on' ? (
              <Button variant="ghost" onClick={() => void disableLink()}>
                Turn off
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void enableLink()}>
                {link.state === 'error' ? 'Try again' : 'Turn on'}
              </Button>
            )}
          </div>
          {link.state === 'error' && link.fixUrl && (
            <Button variant="ghost" size="sm" icon={<ExternalLink />} onClick={() => void api('triggers.openFix')}>
              Open the page that fixes it
            </Button>
          )}
          {link.conflict && (
            <Button variant="ghost" size="sm" onClick={() => setTakingOver(true)}>
              Use this project&rsquo;s webhook for Hiveory
            </Button>
          )}
        </section>

        {!apps ? null : !apps.keySet || accounts.length === 0 ? (
          <EmptyState
            compact
            icon={<Zap />}
            title={apps.keySet ? 'Connect an app first' : 'Add your Composio key first'}
            description="Triggers watch the apps you connected through Composio: a new email, a GitHub issue, a Slack message…"
            actions={
              <Button variant="primary" onClick={() => openSettings('extensions')}>
                Open Apps
              </Button>
            }
          />
        ) : (
          <section className={styles.card} aria-label="New trigger">
            <div className={styles.sentence}>
              <span className={styles.word}>
                <Zap aria-hidden className={styles.icon} /> When
              </span>
              <Select
                label="App account"
                hideLabel
                value={account?.id ?? ''}
                options={accounts.map((a) => ({ value: a.id, label: `${appName(a.appId)}${a.label ? ` · ${a.label}` : ''}` }))}
                onChange={(v) => {
                  setAccountId(v)
                  setSlug('')
                  setValues({})
                }}
              />
              <Select
                label="Event"
                hideLabel
                value={type?.slug ?? ''}
                options={appTypes?.length ? appTypes.map((t) => ({ value: t.slug, label: t.name })) : [{ value: '', label: appTypes ? 'No events for this app' : 'Loading events…', disabled: true }]}
                onChange={(v) => {
                  setSlug(v)
                  setValues({})
                }}
              />
              <ArrowRight aria-hidden className={styles.icon} />
              <Select label="Bot" hideLabel value={bot?.id ?? ''} options={bots.map((b) => ({ value: b.id, label: b.name }))} onChange={setBotId} />
              <span className={styles.word}>should</span>
            </div>
            {type?.description && <p className={styles.hint}>{type.description}</p>}
            {type?.fields.map((f) =>
              f.type === 'boolean' ? (
                <div key={f.key} className={styles.row}>
                  <span className={styles.text}>
                    {f.label}
                    {f.description && <span className={styles.hint}>{f.description}</span>}
                  </span>
                  <Toggle label={f.label} checked={Boolean(values[f.key] ?? f.default ?? false)} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} />
                </div>
              ) : (
                <TextField
                  key={f.key}
                  label={`${f.label}${f.required ? '' : ' (optional)'}`}
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={String(values[f.key] ?? f.default ?? '')}
                  placeholder={f.description}
                  onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))}
                />
              )
            )}
            <TextAreaField
              label="What it should do with each event"
              value={prompt}
              maxLength={MAX_TRIGGER_PROMPT}
              rows={3}
              placeholder="…summarise what happened and suggest the next step."
              onChange={setPrompt}
            />
            {bot && !bot.routines && <p className={styles.problem}>{bot.name} doesn&rsquo;t work on its own yet: turn on &ldquo;Runs on a schedule&rdquo; in its settings.</p>}
            <div className={styles.end}>
              <span className={styles.hint}>Each event runs read-only, and the bot treats it as data, never as orders.</span>
              <Button variant="primary" onClick={() => void submit()} disabled={!type || !bot || !bot.routines || missing.length > 0} title={missing.length ? `Fill in ${missing.map((f) => f.label).join(', ')}` : undefined}>
                Create trigger
              </Button>
            </div>
          </section>
        )}

        <section aria-label="Your triggers" className={styles.list}>
          <div className={styles.listHead}>
            <h2 className={styles.heading}>Your triggers</h2>
            <span className={styles.hint}>{triggers.length}</span>
          </div>
          {triggers.length === 0 ? (
            <p className={styles.empty}>No triggers yet. Build one above.</p>
          ) : (
            <ul className={styles.items}>
              {triggers.map((t) => (
                <li key={t.id} className={styles.item}>
                  <span className={styles.text}>
                    <strong>{t.name}</strong>
                    <span className={styles.hint}>
                      {appName(t.appId)} → {botName(t.botId)} · {t.lastEventAt ? `last event ${when(t.lastEventAt)}` : 'no events yet'}
                    </span>
                    {t.prompt && <span className={styles.hint}>{t.prompt}</span>}
                  </span>
                  <IconButton label={`Delete ${t.name}`} icon={<Trash2 />} onClick={() => setDeleting(t.id)} />
                  <Toggle label={`${t.name} on`} checked={t.enabled} onChange={(enabled) => void update(t.id, { enabled })} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this trigger?"
        confirmLabel="Delete trigger"
        danger
        onConfirm={() => {
          if (deleting) void remove(deleting)
          setDeleting(null)
        }}
        onClose={() => setDeleting(null)}
      >
        Composio stops watching for it. Runs it already started stay in the run log.
      </ConfirmDialog>
      <ConfirmDialog
        open={takingOver}
        title="Use this Composio project's webhook for Hiveory?"
        confirmLabel="Use it for Hiveory"
        danger
        onConfirm={() => {
          setTakingOver(false)
          void enableLink(true)
        }}
        onClose={() => setTakingOver(false)}
      >
        Your project sends its webhook to {link.conflict}. Hiveory will point it here and get a new signing secret, so whatever uses that address now stops
        receiving events. A separate Composio project for Hiveory avoids this.
      </ConfirmDialog>
    </section>
  )
}
