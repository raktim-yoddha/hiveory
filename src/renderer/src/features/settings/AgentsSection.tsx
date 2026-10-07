import { CliLogo } from '../../components/cli/CliLogo'
import { Toggle } from '../../components/ui/Toggle'
import { useApp, useClis, useSettings } from '../../stores/data'
import { SettingRow, SettingsPage } from './SettingsScreen'
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
      description="Defaults for new worktrees and presets, and the tools agents get to coordinate each other."
    >
      <div className={styles.group}>
        <div className={styles.groupTitle}>Defaults</div>
        <SettingRow
          title="Auto-approve permissions"
          description="Start with auto-approve on when creating a worktree or preset. You can still turn it off each time."
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
        <div className={styles.groupTitle}>When you close the window</div>
        <SettingRow
          title="Keep agents running in the background"
          description="Closing the window leaves Hiveory in the tray and every agent keeps working; open it again from the tray. Quit from the tray stops them (they resume their conversations next time)."
          control={
            <Toggle
              label="Keep agents running in the background"
              checked={settings.keepRunningInBackground}
              onChange={(keepRunningInBackground) => void update({ keepRunningInBackground })}
            />
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
          description="Seeing, messaging and arranging other agents. The browser, computer use and apps have their own switches. Applies to agents started after the change."
          control={
            <Toggle label="Give agents Hiveory tools" checked={settings.agentTools} onChange={(agentTools) => void update({ agentTools })} />
          }
        />
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Computer use</div>
        <p className={styles.groupNote}>
          Lets agents operate this computer like you do: read any app&apos;s buttons and fields, click, type, press shortcuts, switch windows
          and take screenshots. Agents see apps as text with element refs first, so it is fast and needs no screenshots. Hiveory shows a
          notice whenever an agent starts using it.
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
