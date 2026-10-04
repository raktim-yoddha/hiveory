import { CheckCircle2 } from 'lucide-react'
import { THEMES, type ThemeId } from '@shared/domain'
import { useSettings } from '../../stores/data'
import { SettingsPage } from './SettingsScreen'
import styles from './Settings.module.css'

/** Literal swatches: each card previews its own theme regardless of the active one. */
const PREVIEW: Record<ThemeId, { bg: string; panel: string; pane: string; accent: string }> = {
  bronze: { bg: '#080706', panel: '#14110e', pane: '#1b1814', accent: 'linear-gradient(180deg, #f1e9dc, #bba98c)' },
  silver: { bg: '#070809', panel: '#121418', pane: '#191b1f', accent: 'linear-gradient(180deg, #f5f7fa, #aeb5c0)' }
}

export function AppearanceSection() {
  const { settings, update } = useSettings()
  return (
    <SettingsPage title="Appearance" description="Choose the finish for Hiveory. Terminals and window chrome follow the theme.">
      <div className={styles.themes} role="radiogroup" aria-label="Theme">
        {THEMES.map((theme) => {
          const p = PREVIEW[theme.id]
          const selected = settings.theme === theme.id
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={styles.themeCard}
              onClick={() => void update({ theme: theme.id })}
            >
              <span className={styles.themePreview} style={{ background: p.bg }} aria-hidden>
                <span style={{ background: p.panel }} />
                <span className={styles.previewPane} style={{ background: p.pane }}>
                  <span className={styles.previewBar} style={{ background: p.accent }} />
                </span>
              </span>
              <span className={styles.themeMeta}>
                <span>
                  <span className={styles.themeName}>{theme.name}</span>
                  <br />
                  <span className={styles.themeDescription}>{theme.description}</span>
                </span>
                {selected && <CheckCircle2 className={styles.check} aria-hidden />}
              </span>
            </button>
          )
        })}
      </div>
    </SettingsPage>
  )
}
