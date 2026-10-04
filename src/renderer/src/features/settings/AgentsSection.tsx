import { CliLogo } from '../../components/cli/CliLogo'
import { Toggle } from '../../components/ui/Toggle'
import { useClis, useSettings } from '../../stores/data'
import { SettingRow, SettingsPage } from './SettingsScreen'
import styles from './Settings.module.css'

/** CLIs whose sessions load Hiveory's MCP server (mirrors adapters with `injectMcp`). */
const MCP_CLIS = new Set(['claude', 'codex', 'opencode', 'kilocode', 'copilot'])

const TOOLS: Array<[string, string]> = [
  ['list_agents', 'Every agent in the project with its CLI, workspace and live status'],
  ['read_agent', "What another agent's terminal currently shows"],
  ['send_message', 'Type a message into another agent and submit it'],
  ['wait_for_agent', 'Block until an agent finishes, then report its status'],
  ['open_agent / close_agent', 'Start or stop agents in new panes'],
  ['arrange_panes', 'Equal, focus or columns layout for the workspace'],
  ['run_in_terminal / read_terminal', "Run commands in the workspace's side-panel terminal"],
  ['browser_*', 'Drive the built-in browser — see Settings › Browser']
]

export function AgentsSection() {
  const { settings, update } = useSettings()
  // Select the stable array, filter outside: a fresh array from a selector re-renders forever.
  const allClis = useClis((s) => s.clis)
  const clis = allClis.filter((c) => c.available)
  return (
    <SettingsPage
      title="Agents"
      description="Defaults for new workspaces and presets, and the tools agents get to coordinate each other."
    >
      <div className={styles.group}>
        <div className={styles.groupTitle}>Defaults</div>
        <SettingRow
          title="Auto-approve permissions"
          description="Start with auto-approve on when creating a workspace or preset. You can still turn it off each time."
          control={
            <Toggle
              label="Auto-approve permissions by default"
              checked={settings.defaultAutoApprove}
              onChange={(defaultAutoApprove) => void update({ defaultAutoApprove })}
            />
          }
        />
        <SettingRow
          title="Use chat UI"
          description="Start with the chat view on, so agents open as a chat instead of a terminal. CLIs without a chat mode (such as Antigravity) keep their terminal."
          control={
            <Toggle label="Use chat UI by default" checked={settings.defaultChatUi} onChange={(defaultChatUi) => void update({ defaultChatUi })} />
          }
        />
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Agent tools</div>
        <p className={styles.groupNote}>
          Agents you open in Hiveory get a private, local MCP server so they can see and coordinate each other. It listens on
          this machine only, with a per-launch secret.
        </p>
        <SettingRow
          title="Give agents Hiveory tools"
          description="Applies to agents started after the change."
          control={
            <Toggle label="Give agents Hiveory tools" checked={settings.agentTools} onChange={(agentTools) => void update({ agentTools })} />
          }
        />
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Tools</div>
        <ul className={styles.list}>
          {TOOLS.map(([name, description]) => (
            <li key={name} className={styles.listItem}>
              <div className={styles.listMain}>
                <span className={`${styles.listTitle} ${styles.mono}`}>{name}</span>
                <span className={styles.listMeta}>{description}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Installed CLIs</div>
        <ul className={styles.list}>
          {clis.map((cli) => (
            <li key={cli.id} className={styles.listItem}>
              <CliLogo cliId={cli.id} />
              <div className={styles.listMain}>
                <span className={styles.listTitle}>{cli.displayName}</span>
              </div>
              <span className={`${styles.chip} ${MCP_CLIS.has(cli.id) ? styles.chipOn : ''}`}>
                {MCP_CLIS.has(cli.id) ? 'Tools enabled' : 'No tools support yet'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </SettingsPage>
  )
}
