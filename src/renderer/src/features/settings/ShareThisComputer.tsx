import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { pairingLink, type ShareStatus } from '@shared/domain/tailnet'
import { IconButton } from '../../components/ui/Button'
import { QrCode } from '../../components/ui/QrCode'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { useSettings } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { SettingRow } from './SettingsScreen'
import styles from './Settings.module.css'

/** The pairing code rotates and devices pair from elsewhere, so the panel re-reads while it is open. */
const POLL_MS = 5000

/**
 * Share this computer (ADR 0025): this desktop keeps running everything and
 * also serves its window to the user's other devices over Tailscale — only on
 * loopback and its Tailscale address, never on the local network.
 */
export function ShareThisComputer() {
  const { settings, update } = useSettings()
  const [status, setStatus] = useState<ShareStatus | null>(null)
  const on = settings.shareOnTailnet

  useEffect(() => {
    if (!on) return
    let alive = true
    const read = () =>
      void api('share.status')
        .then((s) => alive && setStatus(s))
        .catch(() => undefined)
    read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [on])

  const where = status?.address && status.port ? `${status.address}:${status.port}` : undefined
  const description = !on
    ? 'Let your other computers use this Hiveory over Tailscale. Agents keep running here while they are away.'
    : status?.state === 'error' || status?.state === 'no-tailscale'
      ? (status.detail ?? 'Not reachable yet.')
      : where
        ? `Reachable at ${where}. Your devices signed in to ${status?.owner ?? 'the same Tailscale account'} connect in one click; others need the code below.`
        : 'Starting…'

  return (
    <div className={styles.group}>
      <SettingRow
        title="Share this computer"
        description={description}
        control={<Toggle label="Share this computer over Tailscale" checked={on} onChange={(shareOnTailnet) => void update({ shareOnTailnet })} />}
      />
      {on && status?.code && (
        <SettingRow
          title="This computer’s pairing code"
          description="For a device on another Tailscale account, or connecting over SSH. Single use; a new one replaces it after 15 minutes."
          control={<span className={`${styles.chip} ${styles.chipOn} ${styles.mono}`}>{status.code}</span>}
        />
      )}
      {on && status?.code && status.address && status.port && (
        <SettingRow
          title="Connect your phone"
          description="Open the Hiveory app on your phone and scan this. Your phone needs Tailscale, signed in like this computer. Phones can watch and steer agents but not delete or change settings."
          control={<QrCode value={pairingLink(status.address, status.port, status.code)} label="Pairing code for the Hiveory phone app" />}
        />
      )}
      {on && status && status.devices.length > 0 && (
        <>
          <div className={styles.groupTitle}>Paired devices</div>
          <ul className={styles.list}>
            {status.devices.map((d) => (
              <li key={d.id} className={styles.listItem}>
                <div className={styles.listMain}>
                  <span className={styles.listTitle}>{d.name}</span>
                  <span className={styles.listMeta}>
                    {d.kind === 'mobile' ? 'Phone' : 'Desktop'} · paired {new Date(d.pairedAt).toLocaleString()}
                  </span>
                </div>
                <IconButton
                  label={`Remove ${d.name}`}
                  icon={<Trash2 />}
                  onClick={() =>
                    void runAction(`Remove ${d.name}`, async () => {
                      await api('share.revoke', { deviceId: d.id })
                      setStatus(await api('share.status'))
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
