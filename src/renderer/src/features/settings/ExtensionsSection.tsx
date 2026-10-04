import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, RefreshCw, Share2 } from 'lucide-react'
import type { ExtensionsInventory } from '@shared/domain/extensions'
import { CliLogo } from '../../components/cli/CliLogo'
import { Button, IconButton } from '../../components/ui/Button'
import { api } from '../../lib/api'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { runAction, useNotices } from '../../stores/notices'
import { SettingsPage } from './SettingsScreen'
import styles from './Settings.module.css'

/**
 * Skills (Agent Skills standard) and MCP servers across every installed CLI.
 * Read-only by design — each CLI owns its config — plus one explicit action:
 * share a skill with every agent via ~/.agents/skills.
 */
export function ExtensionsSection() {
  const projectId = useNavigation((s) => selectedProjectId(s.view))
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

  const share = (path: string): void =>
    void runAction('Share skill', async () => {
      const { path: target } = await api('extensions.shareSkill', { path })
      useNotices.getState().push({ level: 'info', message: `Shared with every agent: ${target}` })
      await scan()
    })

  return (
    <SettingsPage
      title="Skills & MCP"
      description="What each agent can load. Skills follow the Agent Skills standard (a folder with SKILL.md); MCP servers come from each CLI's own config."
    >
      <div className={styles.rowControl}>
        <Button size="sm" icon={<RefreshCw />} loading={loading} onClick={() => void scan()}>
          Rescan
        </Button>
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Skills · {inventory?.skills.length ?? 0}</div>
        {inventory && inventory.skills.length === 0 && (
          <p className={styles.empty}>No skills found in ~/.agents/skills, ~/.claude/skills, ~/.codex/skills or ~/.cursor/skills.</p>
        )}
        <ul className={styles.list}>
          {inventory?.skills.map((skill) => (
            <li key={skill.path} className={styles.listItem}>
              <div className={styles.listMain}>
                <span className={styles.listTitle}>{skill.name}</span>
                <span className={styles.listMeta} title={skill.description}>
                  {skill.source} · {skill.description ?? 'No description'}
                </span>
                <span className={styles.chips}>
                  {skill.visibleTo.map((cliId) => (
                    <CliLogo key={cliId} cliId={cliId} size="sm" />
                  ))}
                </span>
              </div>
              {!skill.source.endsWith('.agents/skills') && (
                <IconButton label={`Share ${skill.name} with every agent`} icon={<Share2 />} onClick={() => share(skill.path)} />
              )}
              <IconButton
                label={`Open ${skill.name} folder`}
                icon={<FolderOpen />}
                onClick={() => void api('extensions.revealSkill', { path: skill.path }).catch(() => undefined)}
              />
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>MCP servers · {inventory?.mcpServers.length ?? 0}</div>
        {inventory && inventory.mcpServers.length === 0 && <p className={styles.empty}>No MCP servers configured in installed CLIs.</p>}
        <ul className={styles.list}>
          {inventory?.mcpServers.map((server) => (
            <li key={server.name} className={styles.listItem}>
              <div className={styles.listMain}>
                <span className={styles.listTitle}>{server.name}</span>
                <span className={styles.listMeta} title={server.target}>
                  {server.transport} · {server.target ?? 'no target'}
                </span>
              </div>
              <span className={styles.chips}>
                {server.configuredIn.map((c) => (
                  <span key={`${c.cliId}-${c.file}`} title={`${c.file} (${c.scope})`}>
                    <CliLogo cliId={c.cliId} size="sm" />
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </SettingsPage>
  )
}
