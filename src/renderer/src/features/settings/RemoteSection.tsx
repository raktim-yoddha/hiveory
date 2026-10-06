import { useState } from 'react'
import { CheckCircle2, Server } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'
import { SettingRow, SettingsPage } from './SettingsScreen'
import styles from './Settings.module.css'

type Result = Awaited<ReturnType<typeof api<'hosts.check'>>>

/**
 * Remote machines (ADR 0022): one host layer for Work and Bots. Today it checks
 * an SSH host end to end and installs Hiveory's host there; remote projects and
 * bot computers build on the same connection.
 */
export function RemoteSection() {
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
      description="Run agents and bots on other machines over SSH. Hiveory uses your own SSH setup (config, keys, agent, known hosts) and never asks for or stores passwords."
    >
      <SettingRow
        title="Check an SSH host"
        description="An alias from ~/.ssh/config or user@host. The check installs Hiveory's small host program in ~/.hiveory-host on that machine (it needs Node 20 or newer) and connects to it."
        control={null}
      />
      <TextField
        label="SSH host"
        value={destination}
        placeholder="devbox or me@build.example.com"
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
      {result && (
        <p className={styles.rowDescription} role="status">
          <CheckCircle2 aria-hidden /> {result.destination} is ready: {result.value.platform} {result.value.arch}, Node {result.value.node}
          {result.value.installed ? '. Hiveory’s host was installed there.' : '. Hiveory’s host was already up to date.'}
        </p>
      )}
      <SettingRow
        title="Before the first check"
        description="Connect once in a terminal (ssh <host>) so you can check and accept its host key. Hiveory never accepts host keys on its own."
        control={null}
      />
    </SettingsPage>
  )
}
