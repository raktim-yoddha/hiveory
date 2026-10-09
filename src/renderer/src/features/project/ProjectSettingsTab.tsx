import { useEffect, useState } from 'react'
import { DEFAULT_BRANCH_PREFIX, type Project } from '@shared/domain'
import type { GitInfo } from '@shared/domain/github'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { TextInput } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { useProjects } from '../../stores/data'
import { RemoveProjectDialog } from '../projects/RemoveProjectDialog'
import { SettingRow } from '../settings/SettingsScreen'
import { ChatDefaults } from './ChatDefaults'
import settings from '../settings/Settings.module.css'
import styles from './ProjectScreen.module.css'

/**
 * A Workspace's own settings (ADR 0037): its name, how new agents open, the model each chat CLI
 * starts with, how new worktrees are branched, and whether its agents announce themselves.
 * Everything here applies to this Workspace only; unset fields follow Settings › Agents.
 */
export function ProjectSettingsTab({ project }: { project: Project }) {
  const update = useProjects((s) => s.update)
  const [confirming, setConfirming] = useState(false)
  const [git, setGit] = useState<GitInfo | null>(null)
  const s = project.settings ?? {}
  const remote = Boolean(project.host)

  useEffect(() => {
    if (!project.repositoryRoot) return
    void api('git.info', { projectId: project.id }).then(setGit, () => undefined)
  }, [project.id, project.repositoryRoot])

  return (
    <div className={styles.section}>
      <div className={settings.group}>
        <div className={settings.groupTitle}>General</div>
        <SettingRow
          title="Name"
          description="How this workspace is called in the sidebar, on the board and on the phone."
          control={<CommitField key={project.name} label="Workspace name" value={project.name} onCommit={(name) => name && void update(project.id, { name })} />}
        />
        <SettingRow title="Folder" description={<span className={styles.mono}>{project.path}</span>} control={null} />
        <SettingRow
          title="Repository"
          description={<span className={styles.mono}>{project.repositoryRoot ?? 'Not a Git repository'}</span>}
          control={null}
        />
      </div>

      <div className={settings.group}>
        <div className={settings.groupTitle}>Agents</div>
        <SettingRow
          title="New agents open as"
          description={
            remote
              ? 'Agents on an SSH host always open in their terminal.'
              : 'Used by the "+" menu, Open agent and the phone in every worktree here. You can still pick the other one each time. CLIs without a chat mode keep their terminal.'
          }
          control={
            <Select
              label="New agents open as"
              hideLabel
              value={s.agentView ?? ''}
              options={[
                { value: '', label: "Each worktree's choice" },
                { value: 'terminal', label: 'Terminal' },
                { value: 'chat', label: 'Chat' }
              ]}
              onChange={(value) => void update(project.id, { settings: { agentView: value === '' ? null : (value as 'terminal' | 'chat') } })}
            />
          }
        />
        <SettingRow
          title="Announce agents"
          description="Queen Bee's updates and phone notifications when an agent here finishes or needs you. Turn off for a quiet workspace."
          control={<Toggle label="Announce agents in this workspace" checked={s.alerts !== false} onChange={(on) => void update(project.id, { settings: { alerts: on ? null : false } })} />}
        />
      </div>

      {!remote && (
        <div className={settings.group}>
          <div className={settings.groupTitle}>Chat agents start with</div>
          <SettingRow
            title="Model and effort"
            description="For each chat CLI, the model and reasoning effort a new chat agent uses here. Each agent can still change its own."
            control={null}
          />
          <div className={styles.chatDefaultsWrap}>
            <ChatDefaults project={project} />
          </div>
        </div>
      )}

      {project.repositoryRoot && (
        <div className={settings.group}>
          <div className={settings.groupTitle}>New worktrees</div>
          <SettingRow
            title="Branch prefix"
            description={`New branches are named prefix + worktree name, like ${s.branchPrefix ?? DEFAULT_BRANCH_PREFIX}fix-login. Leave empty for no prefix.`}
            control={
              <CommitField
                key={s.branchPrefix ?? DEFAULT_BRANCH_PREFIX}
                label="Branch prefix"
                value={s.branchPrefix ?? DEFAULT_BRANCH_PREFIX}
                onCommit={(value) => void update(project.id, { settings: { branchPrefix: value === DEFAULT_BRANCH_PREFIX ? null : value } })}
              />
            }
          />
          <SettingRow
            title="Start from"
            description="The branch new worktrees are created from."
            control={
              <Select
                label="Base branch for new worktrees"
                hideLabel
                value={s.baseRef ?? ''}
                options={[
                  { value: '', label: `Repository default${git?.defaultBranch ? ` (${git.defaultBranch})` : ''}` },
                  ...(git?.branches ?? (s.baseRef ? [s.baseRef] : [])).map((b) => ({ value: b, label: b }))
                ]}
                onChange={(value) => void update(project.id, { settings: { baseRef: value || null } })}
              />
            }
          />
        </div>
      )}

      <div className={styles.danger}>
        <div>
          <p>Remove from Hiveory</p>
          <p className={styles.muted}>Stops this workspace's agents. Files on disk are not touched.</p>
        </div>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Remove
        </Button>
      </div>
      {confirming && <RemoveProjectDialog project={project} onClose={() => setConfirming(false)} />}
    </div>
  )
}

/** A text setting saved when the user leaves the field or presses Enter (never on every keystroke). Keyed by its value, so a change from elsewhere shows. */
function CommitField({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const commit = (): void => {
    const next = draft.trim()
    if (next !== value) onCommit(next)
  }
  return (
    <TextInput
      className={styles.field}
      aria-label={label}
      value={draft}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(value)
      }}
    />
  )
}
