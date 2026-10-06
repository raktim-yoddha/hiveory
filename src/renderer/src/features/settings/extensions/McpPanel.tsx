import { useState, type CSSProperties } from 'react'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { ConnectionView, ExtensionsInventory } from '@shared/domain'
import { CliLogo } from '../../../components/cli/CliLogo'
import { Button, IconButton } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Toggle } from '../../../components/ui/Toggle'
import { api } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import { useConnections } from '../../../stores/connections'
import { runAction } from '../../../stores/notices'
import { ConnectionStatus } from './ConnectionStatus'
import { ServerDialog } from './ServerDialog'
import settings from '../Settings.module.css'
import styles from './Extensions.module.css'

/**
 * MCP servers: the ones Hiveory runs for every agent (added here or brought
 * over from a CLI), and the ones each CLI configures for itself.
 */
export function McpPanel({ inventory }: { inventory: ExtensionsInventory | null }) {
  const all = useConnections((s) => s.connections)
  const put = useConnections((s) => s.put)
  const servers = all.filter((c) => !c.provider)
  const [editing, setEditing] = useState<ConnectionView | 'new' | null>(null)
  const [removing, setRemoving] = useState<ConnectionView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const inHiveory = new Set(all.map((c) => c.name.toLowerCase()))

  const act = (id: string, label: string, run: () => Promise<ConnectionView | void>): void => {
    setBusy(id)
    void runAction(label, async () => {
      const result = await run()
      if (result) put(result)
    }).finally(() => setBusy(null))
  }

  return (
    <div className={styles.panel}>
      <div className={settings.group}>
        <div className={styles.groupHeader}>
          <div className={settings.groupTitle}>In Hiveory · every agent</div>
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setEditing('new')}>
            Add server
          </Button>
        </div>
        <p className={settings.groupNote}>Hiveory starts these on first use, shares them between agents and stops them when idle.</p>
        {servers.length === 0 && <p className={settings.empty}>None yet. Add one, or bring one over from a CLI below.</p>}
        <ul className={settings.list}>
          {servers.map((server, index) => (
            <li key={server.id} className={cx(settings.listItem, styles.stagger)} style={{ '--i': index } as CSSProperties}>
              <div className={settings.listMain}>
                <span className={styles.skillName}>
                  <span className={settings.listTitle}>{server.name}</span>
                  {server.importedFrom && <span className={styles.badge}>from {server.importedFrom}</span>}
                </span>
                <span className={styles.mono} title={server.target}>
                  {server.target}
                </span>
                {server.state === 'error' && server.error && <span className={cx(styles.status, styles.error)}>{server.error}</span>}
              </div>
              <ConnectionStatus connection={busy === server.id ? { ...server, state: 'connecting' } : server} />
              <Toggle
                label={`Serve ${server.name} to agents`}
                checked={server.enabled}
                onChange={(enabled) => act(server.id, enabled ? 'Turn on server' : 'Turn off server', () => api('connections.setEnabled', { id: server.id, enabled }))}
              />
              <IconButton label={`Reconnect ${server.name}`} icon={<RefreshCw />} onClick={() => act(server.id, 'Reconnect', () => api('connections.test', { id: server.id }))} />
              <IconButton label={`Edit ${server.name}`} icon={<Pencil />} onClick={() => setEditing(server)} />
              <IconButton label={`Remove ${server.name}`} icon={<Trash2 />} onClick={() => setRemoving(server)} />
            </li>
          ))}
        </ul>
      </div>

      <div className={settings.group}>
        <div className={settings.groupTitle}>In your CLIs · {inventory?.mcpServers.length ?? 0}</div>
        <p className={settings.groupNote}>Configured by each CLI for itself. Add one to Hiveory to give it to every agent, whatever its CLI.</p>
        {inventory && inventory.mcpServers.length === 0 && <p className={settings.empty}>No MCP servers configured in installed CLIs.</p>}
        <ul className={settings.list}>
          {inventory?.mcpServers.map((server, index) => {
            const added = inHiveory.has(server.name.toLowerCase())
            return (
              <li key={server.name} className={cx(settings.listItem, styles.stagger)} style={{ '--i': index } as CSSProperties}>
                <div className={settings.listMain}>
                  <span className={settings.listTitle}>{server.name}</span>
                  <span className={styles.mono} title={server.target}>
                    {server.transport} · {server.target ?? 'no target'}
                  </span>
                </div>
                <span className={settings.chips}>
                  {server.configuredIn.map((c) => (
                    <span key={`${c.cliId}-${c.file}`} title={`${c.file} (${c.scope})`}>
                      <CliLogo cliId={c.cliId} size="sm" />
                    </span>
                  ))}
                </span>
                {added ? (
                  <span className={styles.badge}>In Hiveory</span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus />}
                    loading={busy === server.name}
                    disabled={server.transport === 'unknown'}
                    onClick={() => act(server.name, 'Add server to Hiveory', () => api('connections.import', { name: server.name }))}
                  >
                    Add to every agent
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {editing && (
        <ServerDialog key={editing === 'new' ? 'new' : editing.id} server={editing === 'new' ? null : editing} open onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name}?`}
        confirmLabel="Remove"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing
          setRemoving(null)
          if (target) act(target.id, 'Remove server', () => api('connections.remove', { id: target.id }))
        }}
      >
        Agents can no longer use its tools, and its saved keys are deleted from Hiveory.
      </ConfirmDialog>
    </div>
  )
}
