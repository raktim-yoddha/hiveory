import { useEffect, useState } from 'react'
import { Link2, Unplug } from 'lucide-react'
import type { ClientStatus } from '@shared/ipc/contract'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { TextField } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'
import { SettingRow } from './SettingsScreen'
import styles from './Settings.module.css'

const SSH_HOST = /^[A-Za-z0-9_][A-Za-z0-9._-]*(@[A-Za-z0-9_][A-Za-z0-9._-]*)?$/

/**
 * Use a Hiveory server (ADR 0022): the whole app runs on another machine
 * (started there with `hiveory --serve <port>`), and this window becomes its
 * client. Through SSH by default (the server only listens on its loopback),
 * or a direct address such as a Tailscale name. Pairing takes the one-time code
 * the server printed; Hiveory then relaunches as that server's window.
 */
export function ServerConnection() {
  const [status, setStatus] = useState<ClientStatus | null>(null)
  const [via, setVia] = useState<'ssh' | 'direct'>('ssh')
  const [destination, setDestination] = useState('')
  const [port, setPort] = useState('7788')
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api('client.status').then(setStatus).catch(() => undefined)
  }, [])

  const valid =
    /^[A-Za-z0-9]{8}$/.test(code.trim()) &&
    (via === 'ssh' ? SSH_HOST.test(destination.trim()) && Number(port) > 0 && Number(port) < 65536 : /^https?:\/\/\S+$/.test(url.trim()))

  const connect = async (): Promise<void> => {
    setBusy(true)
    const result = await runAction('Connect to the Hiveory server', () =>
      api('client.connect', via === 'ssh' ? { via, destination: destination.trim(), port: Number(port), code: code.trim() } : { via, url: url.trim(), code: code.trim() })
    )
    setBusy(false)
    if (result) setStatus(result)
  }

  if (status?.mode === 'client') {
    return (
      <SettingRow
        title={`Using the Hiveory server ${status.server ?? ''}`}
        description={status.connected ? 'Workspaces, agents and bots run there; this window shows them.' : 'Not reachable right now — reconnecting on its own.'}
        control={
          <Button variant="secondary" icon={<Unplug />} onClick={() => void runAction('Disconnect', () => api('client.disconnect'))}>
            Disconnect
          </Button>
        }
      />
    )
  }

  return (
    <>
      <SettingRow
        title="Use a Hiveory server"
        description="Run everything on another machine (start it there with: hiveory --serve 7788) and use it from this window. Hiveory restarts as that server's window."
        control={null}
      />
      <Select
        label="Reach the server"
        value={via}
        options={[
          { value: 'ssh', label: 'Through SSH (recommended: the server stays on its loopback)' },
          { value: 'direct', label: 'At an address (Tailscale or your own HTTPS proxy)' }
        ]}
        onChange={(v) => setVia(v as 'ssh' | 'direct')}
      />
      {via === 'ssh' ? (
        <div className={styles.row}>
          <TextField label="SSH host" value={destination} placeholder="devbox" onChange={setDestination} />
          <TextField label="Server port" value={port} onChange={(v) => setPort(v.replace(/\D/g, '').slice(0, 5))} />
        </div>
      ) : (
        <TextField label="Server address" value={url} placeholder="http://my-box.tailnet.ts.net:7788" onChange={setUrl} />
      )}
      <TextField
        label="Pairing code"
        value={code}
        placeholder="The 8 characters the server printed"
        onChange={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
        adornment={
          <Button variant="primary" icon={<Link2 />} loading={busy} disabled={!valid} onClick={() => void connect()}>
            Connect
          </Button>
        }
      />
    </>
  )
}
