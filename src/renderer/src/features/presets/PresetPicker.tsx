import { useEffect, useState } from 'react'
import { Layers, Settings2 } from 'lucide-react'
import type { AgentPreset } from '@shared/domain'
import type { AgentConfig } from '../../components/cli/AgentConfigFields'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { usePresets } from '../../stores/data'
import { PresetsDialog } from './PresetsDialog'
import { PresetSummary } from './PresetSummary'
import styles from './Presets.module.css'

interface PresetPickerProps {
  /** Current configuration, offered as the starting point for a new preset. */
  current?: AgentConfig
  onApply: (preset: AgentPreset) => void
}

/** Lists presets to apply, with access to preset management. */
export function PresetPicker({ current, onApply }: PresetPickerProps) {
  const { presets, loaded, load } = usePresets()
  const [managing, setManaging] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  return (
    <div className={styles.picker}>
      {presets.length === 0 ? (
        <EmptyState compact icon={<Layers />} title="No presets yet" description="Save a CLI configuration to reuse it." />
      ) : (
        <ul className={styles.list}>
          {presets.map((preset) => (
            <li key={preset.id}>
              <button type="button" className={styles.option} onClick={() => onApply(preset)}>
                <span className={styles.optionName}>{preset.name}</span>
                <PresetSummary preset={preset} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="ghost" icon={<Settings2 />} onClick={() => setManaging(true)}>
        Manage presets
      </Button>
      {managing && <PresetsDialog initial={current} onClose={() => setManaging(false)} />}
    </div>
  )
}
