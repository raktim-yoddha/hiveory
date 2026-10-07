import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { SkillRoot } from '@shared/domain'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Select } from '../../../components/ui/Select'
import { TextAreaField, TextField } from '../../../components/ui/TextField'
import { api } from '../../../lib/api'
import { runAction } from '../../../stores/notices'
import form from '../../../components/ui/form.module.css'
import styles from './Extensions.module.css'
import { SkillFolderList } from './SkillFolderList'

interface Props {
  open: boolean
  roots: SkillRoot[]
  projectId?: string
  botId?: string
  onClose: () => void
  onCreated: () => Promise<void>
}

/** "My Skill!" → "my-skill": the Agent Skills name format. */
const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64)

const TEMPLATE = '# When to use\n\nDescribe the situations this skill is for.\n\n# Steps\n\n1. …\n'

/** Writes a new SKILL.md into each chosen skills folder, so every CLI reading those folders gets it at once. */
export function NewSkillDialog({ open, roots, projectId, botId, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState(TEMPLATE)
  const [targets, setTargets] = useState<SkillRoot['id'][]>(['agents', 'claude'])
  // A bot's new skill is its own unless the user says otherwise.
  const [scope, setScope] = useState<'user' | 'project'>(botId ? 'project' : 'user')
  const [busy, setBusy] = useState(false)

  const cleanName = name.replace(/-+$/, '')
  const valid = /^[a-z0-9][a-z0-9-]*$/.test(cleanName) && description.trim() && targets.length > 0

  const create = (): void => {
    if (!valid) return
    setBusy(true)
    void runAction('Create skill', async () => {
      await api('extensions.createSkill', {
        name: cleanName,
        description: description.trim(),
        body,
        rootIds: targets,
        projectId: scope === 'project' ? projectId : undefined,
        ...(scope === 'project' && botId ? { botId } : {})
      })
      await onCreated()
    }).finally(() => setBusy(false))
  }

  return (
    <Modal
      open={open}
      title="New skill"
      width="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Plus />} loading={busy} disabled={!valid} onClick={create}>
            Create skill
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.formRow}>
          <TextField label="Name" value={name} onChange={(v) => setName(slug(v))} placeholder="release-notes" autoFocus />
          {projectId || botId ? (
            <Select
              label="Where"
              value={scope}
              onChange={(v) => setScope(v as 'user' | 'project')}
              options={[
                { value: 'user', label: 'Everywhere (your home folder)' },
                { value: 'project', label: botId ? 'This bot only' : 'This workspace only' }
              ]}
            />
          ) : (
            <div />
          )}
        </div>
        <TextField
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="What it does and when an agent should use it"
        />
        <TextAreaField label="Instructions (SKILL.md)" mono value={body} onChange={setBody} />
        <div className={form.field}>
          <span className={styles.fieldTitle}>Folders</span>
          <SkillFolderList
            roots={roots}
            isOn={(root) => targets.includes(root.id)}
            onToggle={(root) => setTargets((t) => (t.includes(root.id) ? t.filter((id) => id !== root.id) : [...t, root.id]))}
          />
          <span className={styles.hint}>Shared (.agents) reaches every CLI that follows the Agent Skills standard; the others are each CLI's own folder (installed CLIs only).</span>
        </div>
      </div>
    </Modal>
  )
}
