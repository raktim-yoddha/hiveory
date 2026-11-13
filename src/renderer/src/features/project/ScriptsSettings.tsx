import { useState } from 'react'
import { GitBranchPlus, Play, Plus, Trash2 } from 'lucide-react'
import { withOnCreate, type Project, type WorkspaceScript } from '@shared/domain'
import { Button, IconButton } from '../../components/ui/Button'
import { TextInput } from '../../components/ui/TextField'
import { useProjects } from '../../stores/data'
import { selectedWorkspaceId, useNavigation } from '../../stores/navigation'
import { runScript } from '../agents/run-script'
import { scriptProblem } from './scripts'
import settings from '../settings/Settings.module.css'
import styles from './ScriptsSettings.module.css'

/**
 * A Workspace's scripts (ADR 0061): named commands — dev, test, lint — that the pane "+", Find and the
 * phone run in a new terminal of the worktree. Run here starts one in the worktree on screen.
 */
export function ScriptsSettings({ project }: { project: Project }) {
  const update = useProjects((s) => s.update)
  const scripts = project.settings?.scripts ?? []
  const workspaceId = useNavigation((s) => selectedWorkspaceId(s.view))
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [tried, setTried] = useState(false)
  const problem = scriptProblem(name.trim(), command.trim(), scripts)

  const save = (next: WorkspaceScript[]): Promise<void> => update(project.id, { settings: { scripts: next.length ? next : null } })
  const add = (): void => {
    setTried(true)
    if (problem) return
    void save([...scripts, { name: name.trim(), command: command.trim() }]).then(() => {
      setName('')
      setCommand('')
      setTried(false)
    })
  }

  return (
    <div className={settings.group}>
      <div className={settings.groupTitle}>Scripts</div>
      <p className={settings.groupNote}>
        Commands you run often, by name. The pane &ldquo;+&rdquo;, Find and the phone start one in a new terminal of the worktree. Turn on{' '}
        <GitBranchPlus aria-hidden className={styles.inlineIcon} /> to also run it in every new worktree, such as an install. Git-ignored files listed
        in the repository&rsquo;s <code>.worktreeinclude</code> (<code>.env</code>…) are copied into new worktrees.
      </p>
      {scripts.length > 0 && (
        <ul className={styles.list} aria-label="Scripts">
          {scripts.map((s) => (
            <li key={s.name} className={styles.row}>
              <span className={styles.name}>{s.name}</span>
              <code className={styles.command} title={s.command}>
                {s.command}
              </code>
              <IconButton
                label={s.onCreate ? `${s.name} runs in every new worktree. Stop that` : `Also run ${s.name} in every new worktree`}
                icon={<GitBranchPlus />}
                active={Boolean(s.onCreate)}
                aria-pressed={Boolean(s.onCreate)}
                onClick={() => void save(scripts.map((x) => (x.name === s.name ? withOnCreate(x, !x.onCreate) : x)))}
              />
              {workspaceId && <IconButton label={`Run ${s.name}`} icon={<Play />} onClick={() => void runScript(workspaceId, project.id, s)} />}
              <IconButton label={`Remove ${s.name}`} icon={<Trash2 />} onClick={() => void save(scripts.filter((x) => x.name !== s.name))} />
            </li>
          ))}
        </ul>
      )}
      <div className={styles.form}>
        <TextInput className={styles.nameField} aria-label="Script name" placeholder="dev" value={name} maxLength={40} onChange={setName} />
        <TextInput
          className={styles.commandField}
          aria-label="Script command"
          placeholder="pnpm dev"
          value={command}
          maxLength={2000}
          onChange={setCommand}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button size="sm" icon={<Plus />} onClick={add} disabled={!name.trim() || !command.trim()}>
          Add
        </Button>
      </div>
      {tried && problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
