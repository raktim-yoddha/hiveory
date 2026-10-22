import { useEffect, useState } from 'react'
import { Link2, RefreshCw, Terminal } from 'lucide-react'
import type { DiscoveredDevice, Discovery, LanServer } from '@shared/domain/tailnet'
import { Button, IconButton } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'
import styles from './Settings.module.css'

const STATE_NOTE: Record<Exclude<Discovery['state'], 'running'>, string> = {
  missing: 'Install Tailscale on both computers and sign in to the same account. Your devices then show up here.',
  stopped: 'Tailscale is off or signed out on this computer. Turn it on and refresh.'
}

/** Phones run no SSH and share no Hiveory: they pair from their own app, scanning this computer's code. */
const isPhone = (d: DiscoveredDevice): boolean => /^(android|ios)$/i.test(d.os)

/** A pairing code as typed: eight letters and digits. */
const cleanCode = (v: string): string =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)

const describe = (d: DiscoveredDevice): string => {
  const where = [d.dnsName || d.ip, d.os].filter(Boolean).join(' · ')
  if (!d.online) return `${where} · offline`
  if (isPhone(d)) return `${where} · phone: open the Hiveory app there and scan “Connect your phone” under Share this computer`
  if (d.hiveory) return `${where} · Hiveory ${d.hiveory.version}${d.mine ? ' · yours, connects in one click' : ' · needs its pairing code'}`
  return `${where} · not sharing Hiveory (turn on “Share this computer” there, or use it over SSH)`
}

/**
 * The user's own devices, found through Tailscale (ADR 0025). A device that
 * shares Hiveory connects in one click when it is signed in to the same
 * Tailscale account, or with its pairing code otherwise; any other online
 * device can be used over SSH. Computers sharing on this Wi-Fi are listed too
 * and pair with their code (ADR 0052).
 */
export function TailnetDevices({ onUseSsh }: { onUseSsh: (destination: string) => void }) {
  const [discovery, setDiscovery] = useState<Discovery | null>(null)
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)
  /** The device that asked for a code, and the code typed so far. */
  const [asking, setAsking] = useState<{ ip: string; code: string } | null>(null)
  /** Codes typed for computers on this Wi-Fi, by address. */
  const [lanCodes, setLanCodes] = useState<Record<string, string>>({})

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setDiscovery((await runAction('Find your devices', () => api('client.discover'))) ?? null)
    setLoading(false)
  }

  useEffect(() => {
    let alive = true
    void api('client.discover')
      .then((d) => alive && setDiscovery(d))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const connect = async (d: DiscoveredDevice, code?: string): Promise<void> => {
    if (!d.hiveory) return
    setConnecting(d.ip)
    const result = await runAction(`Connect to ${d.name}`, () =>
      api('client.connect', {
        via: 'tailnet',
        ip: d.ip,
        port: d.hiveory!.port,
        name: d.name,
        code
      })
    )
    setConnecting(null)
    // The server asked for its code (another Tailscale account, or it has none to compare): ask for it here.
    if (!result) setAsking({ ip: d.ip, code: '' })
  }

  /** A computer on this Wi-Fi (ADR 0052): always paired with its code, as anyone nearby could find it. */
  const connectLan = async (s: LanServer): Promise<void> => {
    const code = lanCodes[s.address] ?? ''
    if (code.length !== 8) return
    setConnecting(s.address)
    await runAction(`Connect to ${s.name}`, () => api('client.connect', { via: 'direct', url: `http://${s.address}:${s.port}`, code }))
    setConnecting(null)
  }

  return (
    <div className={styles.group}>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>Your devices</span>
          <span className={styles.rowDescription}>Computers on your Tailscale network and on this Wi-Fi. Pick one to use its Hiveory from this window.</span>
        </div>
        <div className={styles.rowControl}>
          <IconButton label="Refresh devices" icon={<RefreshCw />} disabled={loading} onClick={() => void refresh()} />
        </div>
      </div>
      {discovery && discovery.state !== 'running' && <p className={styles.groupNote}>{STATE_NOTE[discovery.state]}</p>}
      {discovery?.state === 'running' && discovery.devices.length === 0 && <p className={styles.empty}>No other devices on your tailnet yet.</p>}
      {discovery?.state === 'running' && discovery.devices.length > 0 && (
        <ul className={styles.list} aria-busy={loading}>
          {discovery.devices.map((d) => (
            <li key={d.ip} className={styles.listItem}>
              <div className={styles.listMain}>
                <span className={styles.listTitle}>{d.name}</span>
                <span className={styles.listMeta}>{describe(d)}</span>
                {asking?.ip === d.ip && (
                  <TextField
                    label={`Pairing code shown on ${d.name}`}
                    value={asking.code}
                    placeholder="8 characters"
                    onChange={(v) => setAsking({ ip: d.ip, code: cleanCode(v) })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && asking.code.length === 8) void connect(d, asking.code)
                    }}
                  />
                )}
              </div>
              {d.online && d.hiveory && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Link2 />}
                  loading={connecting === d.ip}
                  disabled={asking?.ip === d.ip && asking.code.length !== 8}
                  onClick={() => void connect(d, asking?.ip === d.ip ? asking.code : undefined)}
                >
                  Connect
                </Button>
              )}
              {d.online && !d.hiveory && !isPhone(d) && (
                <Button size="sm" icon={<Terminal />} onClick={() => onUseSsh(d.dnsName || d.name)}>
                  Use over SSH
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {discovery && (
        <>
          <div className={styles.groupTitle}>On this network</div>
          {!discovery.lan?.length && <p className={styles.empty}>No computer on this Wi-Fi shares Hiveory. Turn on “On this network” under Share this computer there.</p>}
          {!!discovery.lan?.length && (
            <ul className={styles.list} aria-busy={loading}>
              {discovery.lan.map((s) => (
                <li key={`${s.address}:${s.port}`} className={styles.listItem}>
                  <div className={styles.listMain}>
                    <span className={styles.listTitle}>{s.name}</span>
                    <span className={styles.listMeta}>
                      {s.address} · Hiveory {s.version} · needs its pairing code
                    </span>
                    <TextField
                      label={`Pairing code shown on ${s.name}`}
                      value={lanCodes[s.address] ?? ''}
                      placeholder="8 characters"
                      onChange={(v) => setLanCodes({ ...lanCodes, [s.address]: cleanCode(v) })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void connectLan(s)
                      }}
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Link2 />}
                    loading={connecting === s.address}
                    disabled={(lanCodes[s.address] ?? '').length !== 8}
                    onClick={() => void connectLan(s)}
                  >
                    Connect
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
