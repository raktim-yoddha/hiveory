import { useCallback, useEffect, useState } from 'react'
import { Blocks, RefreshCw, ScrollText, Server } from 'lucide-react'
import { PLUGINS, type ExtensionsInventory } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { api } from '../../lib/api'
import { useConnections } from '../../stores/connections'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { McpPanel } from './extensions/McpPanel'
import { PluginsPanel } from './extensions/PluginsPanel'
import { SkillsPanel } from './extensions/SkillsPanel'
import { SettingsPage } from './SettingsScreen'
import styles from './extensions/Extensions.module.css'

type Tab = 'skills' | 'mcp' | 'plugins'

/**
 * Everything agents can load, in one place: Agent Skills across CLIs, MCP
 * servers (Hiveory's own and each CLI's), and plugins — apps set up with the
 * user's own keys and served to every agent by Hiveory (ADR 0017).
 */
export function ExtensionsSection() {
  const projectId = useNavigation((s) => selectedProjectId(s.view))
  const connections = useConnections((s) => s.connections)
  const [tab, setTab] = useState<Tab>('skills')
  const [inventory, setInventory] = useState<ExtensionsInventory | null>(null)
  const [loading, setLoading] = useState(false)

  const scan = useCallback(async () => {
    setLoading(true)
    const result = await runAction('Scan skills and MCP servers', () => api('extensions.scan', { projectId }))
    if (result) setInventory(result)
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    void api('extensions.scan', { projectId })
      .then((result) => !cancelled && setInventory(result))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [projectId])

  const skillCount = new Set(inventory?.skills.map((s) => `${s.scope}:${s.folder}`)).size
  const serverCount = connections.filter((c) => !c.pluginId).length + (inventory?.mcpServers.length ?? 0)
  const pluginCount = connections.filter((c) => c.pluginId).length
  const count = (n: number) => <span className={styles.count}>{n}</span>

  return (
    <SettingsPage
      title="Skills, MCP & Plugins"
      description="Everything your agents can load. Hiveory serves its MCP servers and plugins to every agent — terminal and chat — without touching any CLI's own config."
    >
      <div className={styles.header}>
        <Tabs<Tab>
          label="Extensions"
          variant="segmented"
          size="lg"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'skills', label: 'Skills', icon: <ScrollText />, badge: count(skillCount) },
            { value: 'mcp', label: 'MCP servers', icon: <Server />, badge: count(serverCount) },
            { value: 'plugins', label: 'Plugins', icon: <Blocks />, badge: count(pluginCount || PLUGINS.length) }
          ]}
        />
        {tab !== 'plugins' && <IconButton label="Rescan" icon={<RefreshCw className={loading ? 'spin' : undefined} />} onClick={() => void scan()} />}
      </div>
      {tab === 'skills' && <SkillsPanel key="skills" inventory={inventory} projectId={projectId} onChanged={scan} />}
      {tab === 'mcp' && <McpPanel key="mcp" inventory={inventory} />}
      {tab === 'plugins' && <PluginsPanel key="plugins" />}
    </SettingsPage>
  )
}
