import { CliLogo } from '../../components/cli/CliLogo'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import type { DesktopAlerts } from '@shared/domain'
import { useApp, useClis, useSettings } from '../../stores/data'
import { SettingRow, SettingsPage } from './SettingsPage'
import { HiveoryPetSettings } from './HiveoryPetSettings'
import { TerminalHostSettings } from './TerminalHostSettings'
import styles from './Settings.module.css'

/** CLIs whose sessions load Hiveory's MCP server (mirrors adapters with `injectMcp`). */
const MCP_CLIS = new Set(['claude', 'codex', 'opencode', 'kilocode', 'copilot'])

const TOOLS: Array<[string, string]> = [
  ['list_agents', 'Every agent in the workspace with its CLI, worktree and live status'],
  ['read_agent', "What another agent's terminal currently shows"],
  ['send_message', 'Type a message into another agent and submit it'],
  ['ask_agent', 'Send, wait and read the reply — delegation in one call'],
  ['run_tools', 'Several tool calls in one round trip, in parallel'],
  ['wait_for_agent', 'Block until an agent finishes, then report its status'],
  ['open_agent / close_agent', 'Start or stop agents in new panes'],
  ['arrange_panes', 'Equal, focus or columns layout for the worktree'],
  ['run_in_terminal / read_terminal', "Run commands in the worktree's side-panel terminal"],
  ['list_scripts / run_script', 'The Workspace scripts (dev, test…), each started in a terminal pane of its own'],
  ['browser_*', 'Drive the built-in browser — see Settings › Browser'],
  ['computer_*', 'Mouse, keyboard, windows and screen of this computer (when Computer use is on)']
]

export function AgentsSection() {
  const { settings, update } = useSettings()
  const info = useApp((s) => s.info)
  // Select the stable array, filter outside: a fresh array from a selector re-renders forever.
  const allClis = useClis((s) => s.clis)
  const clis = allClis.filter((c) => c.available)
  return (
    <SettingsPage
      title="Agents"
      description="Defaults for new agents, and the tools they use to work together."
    >
      <div className={styles.group}>
        <div className={styles.groupTitle}>Defaults</div>
        <SettingRow
          title="Skip permissions (YOLO)"
          description="Every agent starts in its CLI's skip-permissions mode (--dangerously-skip-permissions, --yolo…) from its next start. Off: each worktree and preset chooses."
          control={
            <Toggle
              label="Skip permissions (YOLO) for every agent"
              checked={settings.defaultAutoApprove}
              onChange={(defaultAutoApprove) => void update({ defaultAutoApprove })}
            />
          }
        />
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Notifications</div>
        <SettingRow
          title="Desktop notifications"
          description="When an agent needs you, finishes or stops, unless its worktree is on screen. Click one to open that agent."
          control={
            <Select
              label="Desktop notifications"
              hideLabel
              value={settings.desktopAlerts}
              onChange={(desktopAlerts) => void update({ desktopAlerts: desktopAlerts as DesktopAlerts })}
              options={[
                { value: 'all', label: 'Needs you, finished, stopped' },
                { value: 'needs-you', label: 'Only when an agent needs you' },
                { value: 'off', label: 'Off' }
              ]}
            />
          }
        />
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>When you close the window</div>
        <SettingRow
          title="Keep agents running in the background"
          description="Closing the window keeps Hiveory in the tray, with every agent working. Quit from the tray stops them."
          control={
            <Toggle
              label="Keep agents running in the background"
              checked={settings.keepRunningInBackground}
              onChange={(keepRunningInBackground) => void update({ keepRunningInBackground })}
            />
          }
        />
      </div>
      <TerminalHostSettings />
      <HiveoryPetSettings />
      <div className={styles.group}>
        <div className={styles.groupTitle}>Agent tools</div>
        <p className={styles.groupNote}>
          A private MCP server on this computer lets agents see and coordinate each other.
        </p>
        <SettingRow
          title="Give agents Hiveory tools"
          description="See, message and arrange other agents. Applies to agents started after the change."
          control={
            <Toggle label="Give agents Hiveory tools" checked={settings.agentTools} onChange={(agentTools) => void update({ agentTools })} />
          }
        />
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Computer use</div>
        <p className={styles.groupNote}>
          Agents can click, type and read other apps on this computer. Hiveory shows a notice whenever one starts.
        </p>
        <SettingRow
          title="Give agents computer use"
          description={info?.platform === 'win32' ? 'Off by default. Takes effect on the next tool call.' : 'Available on Windows for now.'}
          control={
            <Toggle
              label="Give agents computer use"
              checked={settings.computerUse}
              disabled={info !== null && info.platform !== 'win32'}
              onChange={(computerUse) => void update({ computerUse })}
            />
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
