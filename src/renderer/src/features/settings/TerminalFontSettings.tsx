import { useEffect, useState } from 'react'
import { FONT_WEIGHTS, safeTerminalFont, TERMINAL_FONT_LIMITS, type FontWeight, type TerminalFont } from '@shared/domain'
import { CounterControl } from '../../components/ui/CounterControl'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { monospaceFamilies } from '../../lib/fonts'
import { useSettings } from '../../stores/data'
import { SettingRow } from './SettingsScreen'
import styles from './Settings.module.css'

const WEIGHT_NAMES: Record<FontWeight, string> = {
  '100': 'Thin',
  '200': 'Extra light',
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'Semibold',
  '700': 'Bold',
  '800': 'Extra bold',
  '900': 'Black'
}
const WEIGHTS = FONT_WEIGHTS.map((w) => ({ value: w, label: `${WEIGHT_NAMES[w]} (${w})` }))

/**
 * Settings › Appearance › Terminal font (ADR 0039): typeface, size, line height, weights and text
 * rendering for terminal panes. Every change goes through `safeTerminalFont`, so no combination of
 * values can leave a terminal unreadable; a missing family falls back to the default list.
 */
export function TerminalFontSettings() {
  const { settings, update } = useSettings()
  const font = settings.terminalFont
  const [families, setFamilies] = useState<string[] | null>(null)
  const set = (patch: Partial<TerminalFont>): void => void update({ terminalFont: safeTerminalFont({ ...font, ...patch }) })

  useEffect(() => {
    let live = true
    void monospaceFamilies().then((list) => live && setFamilies(list))
    return () => {
      live = false
    }
  }, [])

  const installedNerd = families?.some((f) => /^JetBrainsMono (Nerd Font|NF)$/.test(f))
  const options = [
    { value: '', label: `Default (${installedNerd ? 'JetBrainsMono Nerd Font' : 'JetBrains Mono'})` },
    // A family chosen earlier stays listed even if it is no longer installed (the default list takes over).
    ...[...new Set([...(families ?? []), ...(font.family ? [font.family] : [])])].map((f) => ({ value: f, label: f }))
  ]

  return (
    <>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Terminal font · Typeface</div>
        <SettingRow
          title="Family"
          description={families && families.length === 0 ? 'Installed fonts could not be read; the default is used.' : 'Only monospaced families are listed.'}
          control={<Select label="Font family" hideLabel value={font.family} options={options} onChange={(family) => set({ family })} />}
        />
        <SettingRow
          title="Size"
          control={
            <CounterControl label="Font size" value={font.size} min={TERMINAL_FONT_LIMITS.size.min} max={TERMINAL_FONT_LIMITS.size.max} format={(v) => `${v} pt`} onChange={(size) => set({ size })} />
          }
        />
        <SettingRow
          title="Line height"
          control={
            <CounterControl
              label="Line height"
              value={font.lineHeight}
              step={0.01}
              min={TERMINAL_FONT_LIMITS.lineHeight.min}
              max={TERMINAL_FONT_LIMITS.lineHeight.max}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(lineHeight) => set({ lineHeight })}
            />
          }
        />
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Terminal font · Weight</div>
        <SettingRow title="Regular" control={<Select label="Regular weight" hideLabel value={font.weight} options={WEIGHTS} onChange={(weight) => set({ weight: weight as FontWeight })} />} />
        <SettingRow title="Bold" control={<Select label="Bold weight" hideLabel value={font.boldWeight} options={WEIGHTS} onChange={(boldWeight) => set({ boldWeight: boldWeight as FontWeight })} />} />
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Terminal font · Rendering</div>
        <SettingRow title="Italic text" control={<Toggle label="Italic text" checked={font.italic} onChange={(italic) => set({ italic })} />} />
        <SettingRow title="Show bold text in bright colors" control={<Toggle label="Show bold text in bright colors" checked={font.boldBright} onChange={(boldBright) => set({ boldBright })} />} />
      </div>
    </>
  )
}
