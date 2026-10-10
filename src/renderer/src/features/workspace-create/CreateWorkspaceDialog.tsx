import { useCallback, useEffect, useState } from 'react'
import { Dices } from 'lucide-react'
import { branchPrefixOf, type WorkspaceAssociation } from '@shared/domain'
import { totalInstances } from '@shared/presets'
import { AgentConfigFields, type AgentConfig } from '../../components/cli/AgentConfigFields'
import { Button, IconButton } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Tabs } from '../../components/ui/Tabs'
import { TextField, TextInput } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { slugify } from '@shared/naming/names'
import { useProjects, useSettings, useWorkspaces } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { PresetPicker } from '../presets/PresetPicker'
import { GitOptions, type GitChoice, type WorktreeSource } from './GitOptions'
import { IssuePicker } from './IssuePicker'
import styles from './CreateWorkspaceDialog.module.css'

interface CreateWorkspaceDialogProps {
  projectId: string
  /** New branch (default), an existing local branch, or a remote branch (ADR 0038). */
  source?: WorktreeSource
  /** The dialog is mounted only while open, so every opening starts fresh. */
  onClose: () => void
}

type ConfigTab = 'agents' | 'presets'

/**
 * "Create worktree": an isolated copy on its own branch — Git worktree and branch creation happen
 * behind this one action (AGENTS.md rule 13). The Primary always exists already (ADR 0038).
 */
const TITLES: Record<WorktreeSource, string> = {
  new: 'New worktree',
  existing: 'Worktree from an existing branch',
  remote: 'Worktree from a remote branch'
}

export function CreateWorkspaceDialog({ projectId, source = 'new', onClose }: CreateWorkspaceDialogProps) {
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const loadWorkspaces = useWorkspaces((s) => s.load)
  const [suggested, setSuggested] = useState('')
  /** null until the user types, so a new suggestion can replace the name. */
  const [typed, setTyped] = useState<string | null>(null)
  const name = typed ?? suggested
  const [associationKind, setAssociationKind] = useState<WorkspaceAssociation['kind']>('issue')
  const [associationRef, setAssociationRef] = useState('')
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId))
  // Toggles start from the defaults chosen in Settings → Agents; the Workspace's own view wins (ADR 0037).
  const [config, setConfig] = useState<AgentConfig>(() => {
    const { defaultAutoApprove, defaultChatUi } = useSettings.getState().settings
    const view = useProjects.getState().projects.find((p) => p.id === projectId)?.settings?.agentView
    return { cliSelections: [], autoApprove: defaultAutoApprove, chatUi: view ? view === 'chat' : defaultChatUi }
  })
  const [tab, setTab] = useState<ConfigTab>('agents')
  const [busy, setBusy] = useState<'empty' | 'full' | null>(null)
  const [git, setGit] = useState<GitChoice>({ useExistingBranch: false, ready: false })
  const onGitChange = useCallback((choice: GitChoice) => setGit(choice), [])

  const suggest = (): void =>
    void runAction('Suggest worktree name', async () => {
      setSuggested(await api('workspaces.suggestName', { projectId }))
      setTyped(null)
    })

  useEffect(() => {
    void loadWorkspaces(projectId)
  }, [projectId, loadWorkspaces])

  useEffect(() => {
    void runAction('Suggest worktree name', async () => setSuggested(await api('workspaces.suggestName', { projectId })))
  }, [projectId])

  const create = async (withAgents: boolean): Promise<void> => {
    setBusy(withAgents ? 'full' : 'empty')
    const workspace = await runAction('Create worktree', () =>
      api('workspaces.create', {
        projectId,
        kind: 'isolated',
        name: name.trim(),
        association: associationRef.trim() ? { kind: associationKind, ref: associationRef.trim() } : undefined,
        cliSelections: withAgents ? config.cliSelections : [],
        autoApprove: config.autoApprove,
        chatUi: config.chatUi,
        baseRef: git.baseRef,
        branch: git.branch,
        useExistingBranch: git.useExistingBranch,
        remoteBranch: git.remoteBranch
      })
    )
    setBusy(null)
    if (workspace) {
      onClose()
      openWorkspace(projectId, workspace.id)
    }
  }

  const count = totalInstances(config.cliSelections)
  const canSubmit = name.trim().length > 0 && !busy && git.ready

  return (
    <Modal
      open
      title={TITLES[source]}
      onClose={onClose}
      width="lg"
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={() => void create(false)} disabled={!canSubmit} loading={busy === 'empty'}>
            Create empty
          </Button>
          <Button variant="primary" onClick={() => void create(true)} disabled={!canSubmit || count === 0} loading={busy === 'full'}>
            {count > 0 ? `Create with ${count} ${count === 1 ? 'agent' : 'agents'}` : 'Create'}
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <TextField
          label="Worktree name"
          value={name}
          onChange={setTyped}
          maxLength={60}
          adornment={<IconButton label="Suggest another name" icon={<Dices />} size="lg" onClick={suggest} />}
        />
        <GitOptions projectId={projectId} source={source} suggestedBranch={`${branchPrefixOf(project)}${slugify(name)}`} defaultBase={project?.settings?.baseRef} onChange={onGitChange} />
        <div className={styles.association}>
          <span className={styles.label}>Issue / Pull request</span>
          <div className={styles.associationRow}>
            <Tabs
              label="Association type"
              variant="segmented"
              value={associationKind}
              onChange={setAssociationKind}
              options={[
                { value: 'issue', label: 'Issue' },
                { value: 'pull-request', label: 'Pull request' }
              ]}
            />
            <TextInput
              aria-label={associationKind === 'issue' ? 'Issue reference' : 'Pull request reference'}
              placeholder="Optional — number or URL"
              value={associationRef}
              maxLength={300}
              onChange={setAssociationRef}
            />
            {associationKind === 'issue' && <IssuePicker projectId={projectId} onPick={setAssociationRef} />}
          </div>
        </div>
        <div className={styles.config}>
          <Tabs
            label="Agent configuration"
            variant="segmented"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'agents', label: 'Agents' },
              { value: 'presets', label: 'Presets' }
            ]}
          />
          {tab === 'agents' ? (
            <AgentConfigFields value={config} onChange={setConfig} />
          ) : (
            <PresetPicker
              current={config}
              onApply={(preset) => {
                // A preset replaces the configuration; it never merges (STARTER_PROMPT §10).
                setConfig({ cliSelections: preset.cliSelections, autoApprove: preset.autoApprove, chatUi: preset.chatUi ?? false })
                setTab('agents')
              }}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
