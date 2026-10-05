import { useState } from 'react'
import { AlertTriangle, ExternalLink, Lock, Trash2 } from 'lucide-react'
import { RUNNER_INSTALL_URLS, type ConnectionView, type PluginDefinition } from '@shared/domain'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { TextField } from '../../../components/ui/TextField'
import { Toggle } from '../../../components/ui/Toggle'
import { api } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import { useConnections } from '../../../stores/connections'
import { runAction } from '../../../stores/notices'
import { ConnectionStatus } from './ConnectionStatus'
import { PluginLogo } from './PluginLogo'
import styles from './Extensions.module.css'

interface Props {
  plugin: PluginDefinition
  connection?: ConnectionView
  onClose: () => void
}

const RUNNERS = { npx: 'Node.js (npx)', uvx: 'uv (uvx)' } as const

const openUrl = (url: string): void => void api('system.openUrl', { url }).catch(() => undefined)

/** Set up a plugin with the user's own keys: fill the fields, connect, see its tools. Keys are write-only. */
export function PluginSetup({ plugin, connection, onClose }: Props) {
  const requirements = useConnections((s) => s.requirements)
  const put = useConnections((s) => s.put)
  const [values, setValues] = useState<Record<string, string>>(() => connection?.values ?? {})
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const runner = plugin.server.transport === 'stdio' ? plugin.server.command : null
  const missingRunner = runner && requirements && !requirements[runner]
  const saved = new Set(connection?.secretsSet)
  const ready = plugin.fields.every((f) => f.optional || (values[f.key] ?? '').trim() || (f.secret && saved.has(f.key)))

  const connect = (): void => {
    setBusy(true)
    void runAction(`Connect ${plugin.name}`, async () => {
      const view = await api('connections.savePlugin', { pluginId: plugin.id, values })
      put(view)
      setValues(view.values)
    }).finally(() => setBusy(false))
  }

  const remove = (): void => {
    if (!connection) return
    setRemoving(true)
    void runAction(`Remove ${plugin.name}`, async () => {
      await api('connections.remove', { id: connection.id })
      onClose()
    }).finally(() => setRemoving(false))
  }

  const toggle = (enabled: boolean): void => {
    if (!connection) return
    void runAction(enabled ? `Turn on ${plugin.name}` : `Turn off ${plugin.name}`, async () => put(await api('connections.setEnabled', { id: connection.id, enabled })))
  }

  return (
    <Modal
      open
      title={connection ? plugin.name : `Set up ${plugin.name}`}
      width="lg"
      onClose={onClose}
      footer={
        <div className={styles.footerSpread}>
          {connection ? (
            <Button variant="danger" icon={<Trash2 />} loading={removing} onClick={remove}>
              Remove
            </Button>
          ) : (
            <span />
          )}
          <span className={styles.footerEnd}>
            <Button variant="ghost" onClick={onClose}>
              {connection?.state === 'ready' ? 'Done' : 'Cancel'}
            </Button>
            <Button variant="primary" loading={busy} disabled={!ready || Boolean(missingRunner)} onClick={connect}>
              {connection ? 'Save and reconnect' : 'Connect'}
            </Button>
          </span>
        </div>
      }
    >
      <div className={styles.form}>
        <div className={styles.setupHead}>
          <PluginLogo id={plugin.id} name={plugin.name} large />
          <div className={styles.setupText}>
            <h3>{plugin.name}</h3>
            <span className={styles.hint}>{plugin.description}</span>
          </div>
          {connection && (
            <span className={styles.footerEnd}>
              <ConnectionStatus connection={busy ? { ...connection, state: 'connecting' } : connection} />
              <Toggle label={`Give agents ${plugin.name}`} checked={connection.enabled} onChange={toggle} />
            </span>
          )}
        </div>

        {missingRunner && (
          <div className={cx(styles.notice, styles.noticeWarn)}>
            <AlertTriangle aria-hidden />
            <span>
              {plugin.name} runs locally with {RUNNERS[runner]}, which isn&apos;t installed.{' '}
              <button type="button" className={styles.linkButton} onClick={() => openUrl(RUNNER_INSTALL_URLS[runner])}>
                Install it <ExternalLink aria-hidden />
              </button>{' '}
              then reopen this.
            </span>
          </div>
        )}

        {plugin.fields.map((field) => (
          <TextField
            key={field.key}
            label={field.optional ? `${field.label} (optional)` : field.label}
            type={field.secret ? 'password' : 'text'}
            value={values[field.key] ?? ''}
            onChange={(v) => setValues((s) => ({ ...s, [field.key]: v }))}
            placeholder={field.secret && saved.has(field.key) ? '•••••• saved — leave empty to keep' : field.placeholder}
          />
        ))}

        <button type="button" className={styles.linkButton} onClick={() => openUrl(plugin.keyUrl)}>
          Where to get {plugin.fields.some((f) => f.secret) ? 'your key' : 'these details'} <ExternalLink aria-hidden />
        </button>

        <div className={styles.notice}>
          <Lock aria-hidden />
          <span>
            Keys are encrypted on this computer and never leave it except to {plugin.name} itself
            {runner ? `, through the ${plugin.name} server Hiveory runs locally` : ''}. Every agent in Hiveory — terminal and chat — gets{' '}
            {plugin.name}&apos;s tools once it&apos;s connected.
          </span>
        </div>

        {connection?.state === 'error' && connection.error && (
          <div className={cx(styles.notice, styles.noticeError)}>
            <AlertTriangle aria-hidden />
            <span>{connection.error}</span>
          </div>
        )}

        {connection && connection.tools.length > 0 && (
          <div className={styles.form}>
            <span className={styles.fieldTitle}>Tools agents get · {connection.tools.length}</span>
            <div className={styles.tools}>
              {connection.tools.map((tool) => (
                <span key={tool.name} className={styles.tool} title={tool.description}>
                  {tool.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
