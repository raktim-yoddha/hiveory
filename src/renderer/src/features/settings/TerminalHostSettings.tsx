import { useEffect, useState } from 'react'
import type { TerminalHostStatus } from '@shared/host/protocol'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { useSettings } from '../../stores/data'
import { SettingRow } from './SettingsPage'
import styles from './Settings.module.css'

const REFRESH_MS = 5000

const since = (ms?: number): string => (ms ? `since ${new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : '')

/** One line about where terminals run now. */
const describe = (s: TerminalHostStatus): string => {
  const held = `${s.terminals} ${s.terminals === 1 ? 'terminal' : 'terminals'}`
  if (s.mode === 'daemon') return [`Running in the background ${since(s.since)}`.trim(), held, s.runtime ? `version ${s.runtime}` : ''].filter(Boolean).join(' · ')
  if (s.mode === 'utility') return `In a separate process that ends with Hiveory · ${held}`
  return 'Inside Hiveory: the terminal host could not start'
}

/**
 * Settings › Agents › Terminal host (ADR 0050 §11): where agents and terminals run, whether they
 * outlive Hiveory and for how long, and a restart for when it misbehaves.
 */
export function TerminalHostSettings() {
  const { settings, update } = useSettings()
  const [status, setStatus] = useState<TerminalHostStatus | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    let alive = true
    const read = () => void api('terminalHost.status').then((s) => alive && setStatus(s), () => undefined)
    read()
    const timer = setInterval(read, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const restart = async () => {
    setRestarting(true)
    try {
      setStatus(await api('terminalHost.restart'))
    } finally {
      setRestarting(false)
      setConfirming(false)
    }
  }

  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>Terminal host</div>
      <p className={styles.groupNote}>{status ? describe(status) : 'Checking…'}</p>
      <SettingRow
        title="Keep agents running when Hiveory quits"
        description="Agents and terminals keep working after you quit and through updates; each pane picks its terminal back up. Off: quitting stops them."
        control={
          <Toggle
            label="Keep agents running when Hiveory quits"
            checked={settings.keepAgentsAfterQuit}
            onChange={(keepAgentsAfterQuit) => void update({ keepAgentsAfterQuit })}
          />
        }
      />
      <SettingRow
        title="Keep them for"
        description="How long they keep running while Hiveory is closed."
        control={
          <Select
            label="Keep them for"
            hideLabel
            value={settings.detachedGrace}
            options={[
              { value: 'until-exit', label: 'Until they finish' },
              { value: '1h', label: '1 hour' },
              { value: '1d', label: '1 day' },
              { value: '7d', label: '7 days' }
            ]}
            onChange={(detachedGrace) => void update({ detachedGrace: detachedGrace as typeof settings.detachedGrace })}
          />
        }
      />
      <SettingRow
        title="Restart terminal host"
        description="Stops every agent and terminal it holds; agents come back and resume."
        control={
          <Button variant="secondary" onClick={() => setConfirming(true)} disabled={restarting}>
            Restart
          </Button>
        }
      />
      <ConfirmDialog
        open={confirming}
        title="Restart the terminal host?"
        confirmLabel="Restart"
        danger
        busy={restarting}
        onConfirm={() => void restart()}
        onClose={() => setConfirming(false)}
      >
        Every running agent and terminal stops now. Agents start again on their own and resume their conversations; anything a terminal
        was running is ended.
      </ConfirmDialog>
    </div>
  )
}
