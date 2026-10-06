import { useCallback, useEffect, useState } from 'react'
import { Blocks, RefreshCw, ScrollText, Server } from 'lucide-react'
import { COMPOSIO, APPS, type ExtensionsInventory } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { api } from '../../lib/api'
import { useConnections } from '../../stores/connections'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { McpPanel } from './extensions/McpPanel'
import { AppsPanel } from './extensions/AppsPanel'
import { SkillsPanel } from './extensions/SkillsPanel'
import { SettingsPage } from './SettingsScreen'
import styles from './extensions/Extensions.module.css'

type Tab = 'skills' | 'mcp' | 'apps'

/**
 * Everything agents can load, in one place: Agent Skills across CLIs, MCP
 * servers (Hiveory's own and each CLI's), and apps — connected through the
 * user's own Composio project and served to every agent by Hiveory (ADR 0023).
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
  const serverCount = connections.filter((c) => !c.provider).length + (inventory?.mcpServers.length ?? 0)
  const appCount = connections.find((c) => c.provider === COMPOSIO.id)?.apps?.length ?? 0
  const count = (n: number) => <span className={styles.count}>{n}</span>

  return (
    <SettingsPage
      title="Skills, MCP & Apps"
      description="Everything your agents can load. Hiveory serves its MCP servers and apps to every agent — terminal, chat and bots — without touching any CLI's own config."
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
            { value: 'apps', label: 'Apps', icon: <Blocks />, badge: count(appCount || APPS.length) }
          ]}
        />
        {tab !== 'apps' && <IconButton label="Rescan" icon={<RefreshCw className={loading ? 'spin' : undefined} />} onClick={() => void scan()} />}
      </div>
      {tab === 'skills' && <SkillsPanel key="skills" inventory={inventory} projectId={projectId} onChanged={scan} />}
      {tab === 'mcp' && <McpPanel key="mcp" inventory={inventory} />}
      {tab === 'apps' && <AppsPanel key="apps" />}
    </SettingsPage>
  )
}
