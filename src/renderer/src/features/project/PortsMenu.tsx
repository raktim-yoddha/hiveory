import { useState } from 'react'
import { ExternalLink, Network, RefreshCw, Unplug } from 'lucide-react'
import type { RemotePort } from '@shared/domain/tailnet'
import { Button, IconButton } from '../../components/ui/Button'
import { Popover } from '../../components/ui/Popover'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'
import styles from './PortsMenu.module.css'

/**
 * Ports on a remote project's machine (ADR 0025, like Orca's Ports tab): what
 * is listening there, forwarded to this computer in one click and opened in
 * the browser. Forwards last until stopped or Hiveory quits.
 */
export function PortsMenu({ projectId, host }: { projectId: string; host: string }) {
  const [ports, setPorts] = useState<RemotePort[] | null>(null)
  const [busy, setBusy] = useState<number | 'list' | null>(null)

  const load = async (): Promise<void> => {
    setBusy('list')
    setPorts((await runAction(`List ports on ${host}`, () => api('ports.list', { projectId }))) ?? [])
    setBusy(null)
  }

  const act = async (port: number, what: 'forward' | 'stop' | 'open'): Promise<void> => {
    setBusy(port)
    if (what === 'forward') {
      const result = await runAction(`Forward port ${port}`, () => api('ports.forward', { projectId, port }))
      if (result) await runAction(`Open port ${port}`, () => api('ports.open', { projectId, port }))
    } else if (what === 'stop') await runAction(`Stop forwarding ${port}`, () => api('ports.stop', { projectId, port }))
    else await runAction(`Open port ${port}`, () => api('ports.open', { projectId, port }))
    setBusy(null)
    await load()
  }

  return (
    <Popover
      label={`Ports on ${host}`}
      align="end"
      trigger={(props) => (
        <Button
          {...props}
          size="sm"
          icon={<Network />}
          onClick={() => {
            props.onClick()
            void load()
          }}
        >
          Ports
        </Button>
      )}
    >
      {() => (
        <div className={styles.panel}>
          <div className={styles.head}>
            <span className={styles.title}>Listening on {host}</span>
            <IconButton label="Refresh ports" icon={<RefreshCw />} disabled={busy === 'list'} onClick={() => void load()} />
          </div>
          {ports?.length === 0 && <p className={styles.empty}>Nothing is listening there yet. Start a dev server, then refresh.</p>}
          {ports && ports.length > 0 && (
            <ul className={styles.list}>
              {ports.map((p) => (
                <li key={p.port} className={styles.item}>
                  <span className={styles.port}>{p.port}</span>
                  <span className={styles.meta}>{p.localPort ? `→ localhost:${p.localPort}` : p.address}</span>
                  {p.localPort ? (
                    <>
                      <IconButton label={`Open localhost:${p.localPort}`} icon={<ExternalLink />} onClick={() => void act(p.port, 'open')} />
                      <IconButton label={`Stop forwarding ${p.port}`} icon={<Unplug />} onClick={() => void act(p.port, 'stop')} />
                    </>
                  ) : (
                    <Button size="sm" loading={busy === p.port} onClick={() => void act(p.port, 'forward')}>
                      Forward
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  )
}
