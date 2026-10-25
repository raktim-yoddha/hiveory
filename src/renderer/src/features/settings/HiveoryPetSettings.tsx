import { Download } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Toggle } from '../../components/ui/Toggle'
import { openUrl } from '../../lib/open-url'
import { useSettings } from '../../stores/data'
import { SettingRow } from './SettingsPage'
import styles from './Settings.module.css'

const RELEASES = 'https://github.com/raktim-yoddha/pluto/releases/latest'

/**
 * Pluto, formerly Hiveory Pet (ADR 0054): a separate little app at the top of the screen that shows every agent session on this
 * computer, in Hiveory or not. Here: where to get it, and whether it may follow Hiveory's agents.
 */
export function HiveoryPetSettings() {
  const { settings, update } = useSettings()
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>Pluto</div>
      <p className={styles.groupNote}>
        Pluto is a small bot that lives at the top of your screen and shows every agent session on this computer: the ones in Hiveory with
        their pet names and worktrees, and Claude Code, Codex, Gemini CLI, Cursor or Copilot running anywhere else. It peeks out when
        one finishes or needs you. It is a separate app for Windows.
      </p>
      <SettingRow
        title="Get Pluto"
        description="Download it from GitHub and run it, then turn on Hiveory in its Settings. It finds Hiveory on its own while the switch below is on."
        control={
          <Button icon={<Download />} onClick={() => openUrl(RELEASES)}>
            Download
          </Button>
        }
      />
      <SettingRow
        title="Let Pluto see your agents"
        description="Only on this computer. Pluto gets each running agent's pet name, CLI, workspace, worktree and status, never files, paths or what is in its terminal."
        control={<Toggle label="Let Pluto see your agents" checked={settings.petLink} onChange={(petLink) => void update({ petLink })} />}
      />
    </div>
  )
}
