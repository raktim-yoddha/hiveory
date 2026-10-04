import { AppLogo } from '../../components/brand/AppLogo'
import { useApp, useClis } from '../../stores/data'
import { SettingRow, SettingsPage } from './SettingsScreen'
import styles from './Settings.module.css'

export function AboutSection() {
  const info = useApp((s) => s.info)
  const clis = useClis((s) => s.clis)
  return (
    <SettingsPage title="About Hiveory" description="A local-first development environment for running coding agents side by side.">
      <div className={styles.group}>
        <div className={styles.status}>
          <AppLogo size="lg" />
          <div className={styles.rowText}>
            <span className={styles.rowTitle}>Hiveory {info?.version}</span>
            <span className={styles.rowDescription}>{info?.isDev ? 'Development build' : 'Release build'} · {info?.platform}</span>
          </div>
        </div>
        <SettingRow title="Detected CLIs" description={`${clis.filter((c) => c.available).length} of ${clis.length} supported CLIs are installed`} control={null} />
        <SettingRow
          title="Status hooks"
          description={info?.hooksAvailable ? 'Native CLI hooks are reporting agent status' : 'Using terminal heuristics for status'}
          control={null}
        />
        <SettingRow title="Data" description="Everything stays on this machine. No account, no cloud service." control={null} />
      </div>
    </SettingsPage>
  )
}
