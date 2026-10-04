import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, Rocket } from 'lucide-react'
import type { UpdateStatus } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { useApp, useSettings, useUpdates } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { SettingRow, SettingsPage } from './SettingsScreen'
import styles from './Settings.module.css'

const describe = (s: UpdateStatus): { title: string; detail?: string } => {
  switch (s.state) {
    case 'unsupported':
      return { title: 'Updates run in installed builds', detail: s.reason }
    case 'idle':
      return { title: 'Ready to check for updates' }
    case 'checking':
      return { title: 'Checking for updates…' }
    case 'available':
      return { title: `Hiveory ${s.version} is available`, detail: 'Download it now; it installs when you restart.' }
    case 'not-available':
      return { title: 'You are up to date', detail: `Last checked ${new Date(s.lastChecked).toLocaleString()}` }
    case 'downloading':
      return { title: `Downloading ${s.version}… ${s.percent}%` }
    case 'downloaded':
      return { title: `Hiveory ${s.version} is ready`, detail: 'Restart to finish installing.' }
    case 'error':
      return { title: 'Could not check for updates', detail: s.message }
  }
}

const ICON: Record<UpdateStatus['state'], typeof Download> = {
  unsupported: Rocket,
  idle: RefreshCw,
  checking: Loader2,
  available: Download,
  'not-available': CheckCircle2,
  downloading: Loader2,
  downloaded: Rocket,
  error: AlertTriangle
}

export function UpdatesSection() {
  const { status, load } = useUpdates()
  const { settings, update } = useSettings()
  const version = useApp((s) => s.info?.version)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void load()
  }, [load])

  const { title, detail } = describe(status)
  const Icon = ICON[status.state]
  const act = (label: string, fn: () => Promise<unknown>) => async () => {
    setBusy(true)
    await runAction(label, fn)
    setBusy(false)
  }

  return (
    <SettingsPage title="Updates" description={`You are running Hiveory ${version ?? ''}. Updates come from the official GitHub releases.`}>
      <div className={styles.group}>
        <div className={styles.status}>
          <span className={styles.statusIcon}>
            <Icon className={status.state === 'checking' || status.state === 'downloading' ? 'spin' : undefined} />
          </span>
          <div className={styles.rowText} style={{ flex: 1 }}>
            <span className={styles.rowTitle}>{title}</span>
            {detail && <span className={styles.rowDescription}>{detail}</span>}
            {status.state === 'downloading' && (
              <div className={styles.progress} role="progressbar" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}>
                <div className={styles.progressBar} style={{ width: `${status.percent}%` }} />
              </div>
            )}
          </div>
          {status.state === 'available' && (
            <Button variant="primary" icon={<Download />} loading={busy} onClick={act('Download update', () => api('updates.download'))}>
              Download
            </Button>
          )}
          {status.state === 'downloaded' && (
            <Button variant="primary" icon={<Rocket />} onClick={() => void api('updates.install')}>
              Restart & install
            </Button>
          )}
          {status.state !== 'available' && status.state !== 'downloaded' && (
            <Button
              icon={<RefreshCw />}
              loading={busy || status.state === 'checking'}
              disabled={status.state === 'unsupported' || status.state === 'downloading'}
              onClick={act('Check for updates', () => api('updates.check'))}
            >
              Check now
            </Button>
          )}
        </div>
      </div>
      <div className={styles.group}>
        <SettingRow
          title="Check automatically"
          description="On launch and every six hours. Nothing downloads without your click."
          control={
            <Toggle
              label="Check for updates automatically"
              checked={settings.autoCheckUpdates}
              onChange={(autoCheckUpdates) => void update({ autoCheckUpdates })}
            />
          }
        />
      </div>
    </SettingsPage>
  )
}
