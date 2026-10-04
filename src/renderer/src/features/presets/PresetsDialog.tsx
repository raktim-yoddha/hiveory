import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { AgentPreset } from '@shared/domain'
import { AgentConfigFields, type AgentConfig } from '../../components/cli/AgentConfigFields'
import { Button, IconButton } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { TextField } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { usePresets } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { PresetSummary } from './PresetSummary'
import styles from './Presets.module.css'

interface Draft extends AgentConfig {
  id?: string
  name: string
}

interface PresetsDialogProps {
  /** Pre-fills a new preset, e.g. from the Create Workspace configuration. */
  initial?: AgentConfig
  onClose: () => void
}

/** Create, edit and delete presets. Editing reuses AgentConfigFields (STARTER_PROMPT §10). */
export function PresetsDialog({ initial, onClose }: PresetsDialogProps) {
  const presets = usePresets((s) => s.presets)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const startNew = (): void =>
    setDraft({ name: '', cliSelections: initial?.cliSelections ?? [], autoApprove: initial?.autoApprove ?? false })
  const startEdit = (preset: AgentPreset): void => setDraft({ ...preset })

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    const saved = await runAction('Save preset', () => api('presets.save', draft))
    setSaving(false)
    if (saved) setDraft(null)
  }

  const remove = (preset: AgentPreset): void =>
    void runAction('Delete preset', () => api('presets.delete', { presetId: preset.id }))

  return (
    <Modal
      open
      title={draft ? (draft.id ? 'Edit preset' : 'New preset') : 'Presets'}
      onClose={draft ? () => setDraft(null) : onClose}
      width="lg"
      footer={
        draft ? (
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Back
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!draft.name.trim() || draft.cliSelections.length === 0}
              onClick={() => void save()}
            >
              Save preset
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={<Plus />} onClick={startNew}>
            New preset
          </Button>
        )
      }
    >
      {draft ? (
        <div className={styles.editor}>
          <TextField label="Name" value={draft.name} maxLength={60} autoFocus onChange={(name) => setDraft({ ...draft, name })} />
          <AgentConfigFields value={draft} onChange={(config) => setDraft({ ...draft, ...config })} />
        </div>
      ) : presets.length === 0 ? (
        <p className={styles.muted}>Presets remember which CLIs to open, how many of each, and the auto-approve setting.</p>
      ) : (
        <ul className={styles.list}>
          {presets.map((preset) => (
            <li key={preset.id} className={styles.manageRow}>
              <span className={styles.optionName}>{preset.name}</span>
              <PresetSummary preset={preset} />
              <IconButton label={`Edit ${preset.name}`} icon={<Pencil />} onClick={() => startEdit(preset)} />
              <IconButton label={`Delete ${preset.name}`} icon={<Trash2 />} onClick={() => remove(preset)} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
