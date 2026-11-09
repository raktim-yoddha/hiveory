import { useRef, useState } from 'react'
import { CheckCircle2, Server } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { SshHostField } from '../projects/SshHostField'
import { api } from '../../lib/api'
import { useApp } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { ServerConnection } from './ServerConnection'
import { ShareThisComputer } from './ShareThisComputer'
import { TailnetDevices } from './TailnetDevices'
import { SettingRow, SettingsPage } from './SettingsPage'
import styles from './Settings.module.css'

type Result = Awaited<ReturnType<typeof api<'hosts.check'>>>

/**
 * Remote machines (ADR 0022, 0025): the user's own devices found through
 * Tailscale (one click), sharing this computer with them, an SSH host check
 * (Hiveory's host for remote projects), and connecting to a
 * Hiveory server by hand.
 */
export function RemoteSection() {
  const onServer = Boolean(useApp((s) => s.info?.client))
  const sshField = useRef<HTMLDivElement>(null)
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ destination: string; value: Result } | null>(null)
  const valid = /^[A-Za-z0-9_][A-Za-z0-9._-]*(@[A-Za-z0-9_][A-Za-z0-9._-]*)?$/.test(destination.trim())

  const check = async (): Promise<void> => {
    const target = destination.trim()
    setBusy(true)
    setResult(null)
    const value = await runAction('Check SSH host', () => api('hosts.check', { destination: target }))
    setBusy(false)
    if (value) setResult({ destination: target, value })
  }

  return (
    <SettingsPage
      title="Remote"
      description="Use your other computers from here, or this one from them, over Tailscale or SSH."
    >
      <TailnetDevices
        onUseSsh={(host) => {
          setDestination(host)
          setResult(null)
          sshField.current?.scrollIntoView({ block: 'center' })
          sshField.current?.querySelector('input')?.focus()
        }}
      />
      {!onServer && <ShareThisComputer />}
      <SettingRow
        title="Check an SSH host"
        description="An alias from ~/.ssh/config or user@host. Checking installs Hiveory's small host program there."
        control={null}
      />
      <div ref={sshField}>
        <SshHostField
          value={destination}
          onChange={setDestination}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && !busy) void check()
          }}
          adornment={
            <Button variant="primary" icon={<Server />} loading={busy} disabled={!valid} onClick={() => void check()}>
              Check
            </Button>
          }
        />
      </div>
      {result && (
        <p className={styles.rowDescription} role="status">
          <CheckCircle2 aria-hidden /> {result.destination} is ready: {result.value.platform} {result.value.arch}, Node {result.value.node}
          {result.value.installed ? '. Hiveory’s host was installed there.' : '. Hiveory’s host was already up to date.'}
        </p>
      )}
      <SettingRow
        title="Passwords, codes and new hosts"
        description="Hiveory asks here when ssh needs one. Passwords stay in memory only; a changed host key is always refused."
        control={null}
      />
      <ServerConnection />
    </SettingsPage>
  )
}
