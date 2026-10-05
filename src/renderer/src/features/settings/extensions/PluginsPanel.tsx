import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight } from 'lucide-react'
import { PLUGINS, type ConnectionView, type PluginCategory, type PluginDefinition } from '@shared/domain'
import { TextInput } from '../../../components/ui/TextField'
import { cx } from '../../../lib/cx'
import { useConnections } from '../../../stores/connections'
import { ConnectionStatus } from './ConnectionStatus'
import { PluginLogo } from './PluginLogo'
import { PluginSetup } from './PluginSetup'
import settings from '../Settings.module.css'
import styles from './Extensions.module.css'

const CATEGORIES: Array<PluginCategory | 'All' | 'Connected'> = ['All', 'Connected', 'Code', 'Work', 'Data', 'Business', 'Search', 'Media', 'Automation']

/**
 * Apps every agent can use, set up locally with the user's own keys — no
 * OAuth, no account, nothing hosted by Hiveory (ADR 0017).
 */
export function PluginsPanel() {
  const connections = useConnections((s) => s.connections)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All')
  const [open, setOpen] = useState<PluginDefinition | null>(null)
  /** Every account of each plugin (a plugin can have several: work and personal…). */
  const byPlugin = useMemo(() => {
    const map = new Map<string, ConnectionView[]>()
    for (const c of connections) if (c.pluginId) map.set(c.pluginId, [...(map.get(c.pluginId) ?? []), c])
    return map
  }, [connections])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PLUGINS.filter(
      (p) =>
        (category === 'All' || (category === 'Connected' ? byPlugin.has(p.id) : p.category === category)) &&
        (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
    ).sort((a, b) => Number(byPlugin.has(b.id)) - Number(byPlugin.has(a.id)))
  }, [query, category, byPlugin])

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <TextInput value={query} onChange={setQuery} placeholder="Search plugins" aria-label="Search plugins" />
        </div>
      </div>
      <div className={styles.categories} role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={styles.category} aria-pressed={category === c} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className={settings.empty}>{category === 'Connected' ? 'No plugins connected yet.' : 'No plugins match.'}</p>}
      <div className={styles.pluginGrid}>
        {shown.map((plugin, index) => {
          const accounts = byPlugin.get(plugin.id) ?? []
          const connection = accounts.find((a) => a.state === 'error') ?? accounts[0]
          return (
            <button
              key={plugin.id}
              type="button"
              className={cx(styles.pluginCard, styles.stagger, connection?.enabled && styles.pluginCardOn)}
              style={{ '--i': index } as CSSProperties}
              onClick={() => setOpen(plugin)}
            >
              <span className={styles.pluginTop}>
                <PluginLogo id={plugin.id} name={plugin.name} />
                <span className={styles.pluginName}>
                  <strong>{plugin.name}</strong>
                  <span>{plugin.category}</span>
                </span>
              </span>
              <span className={styles.description}>{plugin.description}</span>
              <span className={styles.pluginFoot}>
                {connection ? (
                  <>
                    <ConnectionStatus connection={connection} />
                    {accounts.length > 1 && <span className={styles.accounts}>{accounts.length} accounts</span>}
                  </>
                ) : (
                  <span className={styles.setUp}>
                    Set up <ArrowRight aria-hidden />
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
      <p className={styles.hint}>
        Only apps whose servers work with a key you create yourself are listed. Local plugins run with npx or uvx on this computer; the
        rest talk to the app&apos;s own official endpoint.
      </p>
      {open && <PluginSetup key={open.id} plugin={open} accounts={byPlugin.get(open.id) ?? []} onClose={() => setOpen(null)} />}
    </div>
  )
}
