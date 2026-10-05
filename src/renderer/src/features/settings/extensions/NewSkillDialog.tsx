import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import type { SkillRoot } from '@shared/domain'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Select } from '../../../components/ui/Select'
import { TextField } from '../../../components/ui/TextField'
import { api } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import { runAction } from '../../../stores/notices'
import form from '../../../components/ui/form.module.css'
import styles from './Extensions.module.css'

interface Props {
  open: boolean
  roots: SkillRoot[]
  projectId?: string
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
export function NewSkillDialog({ open, roots, projectId, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState(TEMPLATE)
  const [targets, setTargets] = useState<SkillRoot['id'][]>(['agents', 'claude'])
  const [scope, setScope] = useState<'user' | 'project'>('user')
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
        projectId: scope === 'project' ? projectId : undefined
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
          {projectId ? (
            <Select
              label="Where"
              value={scope}
              onChange={(v) => setScope(v as 'user' | 'project')}
              options={[
                { value: 'user', label: 'Everywhere (your home folder)' },
                { value: 'project', label: 'This project only' }
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
        <div className={form.field}>
          <label className={form.fieldLabel} htmlFor="skill-body">
            Instructions (SKILL.md)
          </label>
          <textarea id="skill-body" className={cx(form.input, styles.textarea)} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
        </div>
        <div className={form.field}>
          <span className={styles.fieldTitle}>Folders</span>
          <span className={styles.folders} role="group" aria-label="Skills folders">
            {roots.map((root) => {
              const on = targets.includes(root.id)
              return (
                <button
                  key={root.id}
                  type="button"
                  aria-pressed={on}
                  className={cx(styles.folder, on && styles.folderOn)}
                  onClick={() => setTargets((t) => (on ? t.filter((id) => id !== root.id) : [...t, root.id]))}
                >
                  {on ? <Check aria-hidden /> : <Plus aria-hidden />}
                  {root.label}
                </button>
              )
            })}
          </span>
          <span className={styles.hint}>Shared (.agents) reaches Codex, Gemini, Copilot, Cursor, OpenCode and more; Claude reads its own folder.</span>
        </div>
      </div>
    </Modal>
  )
}
