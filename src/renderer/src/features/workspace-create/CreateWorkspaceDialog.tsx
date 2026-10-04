import { useCallback, useEffect, useState } from 'react'
import { Dices } from 'lucide-react'
import type { WorkspaceAssociation, WorkspaceKind } from '@shared/domain'
import { totalInstances } from '@shared/presets'
import { AgentConfigFields, type AgentConfig } from '../../components/cli/AgentConfigFields'
import { Button, IconButton } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Tabs } from '../../components/ui/Tabs'
import { TextField, TextInput } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { slugify } from '@shared/naming/names'
import { useWorkspaces } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { PresetPicker } from '../presets/PresetPicker'
import { GitOptions, type GitChoice } from './GitOptions'
import { IssuePicker } from './IssuePicker'
import styles from './CreateWorkspaceDialog.module.css'

interface CreateWorkspaceDialogProps {
  projectId: string
  /** The dialog is mounted only while open, so every opening starts fresh. */
  onClose: () => void
}

type ConfigTab = 'agents' | 'presets'

const EMPTY_CONFIG: AgentConfig = { cliSelections: [], autoApprove: false }
const MAIN_NAME = 'Main'

/**
 * "Create Workspace". A Workspace is either the project folder itself (Main,
 * at most one) or an isolated copy on its own branch — Git worktree and branch
 * creation happen behind this one action (AGENTS.md rule 13, ADR 0011).
 */
export function CreateWorkspaceDialog({ projectId, onClose }: CreateWorkspaceDialogProps) {
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const hasMain = useWorkspaces((s) => (s.byProject[projectId] ?? []).some((w) => w.kind === 'main'))
  const loadWorkspaces = useWorkspaces((s) => s.load)
  /** null until the user picks; the default follows whether a main Workspace exists. */
  const [chosenKind, setKind] = useState<WorkspaceKind | null>(null)
  const kind = chosenKind ?? (hasMain ? 'isolated' : 'main')
  const [suggested, setSuggested] = useState('')
  /** null until the user types, so switching kinds can swap in the right default name. */
  const [typed, setTyped] = useState<string | null>(null)
  const name = typed ?? (kind === 'main' ? MAIN_NAME : suggested)
  const [associationKind, setAssociationKind] = useState<WorkspaceAssociation['kind']>('issue')
  const [associationRef, setAssociationRef] = useState('')
  const [config, setConfig] = useState<AgentConfig>(EMPTY_CONFIG)
  const [tab, setTab] = useState<ConfigTab>('agents')
  const [busy, setBusy] = useState<'empty' | 'full' | null>(null)
  const [git, setGit] = useState<GitChoice>({ useExistingBranch: false, ready: false })
  const onGitChange = useCallback((choice: GitChoice) => setGit(choice), [])

  const suggest = (): void =>
    void runAction('Suggest workspace name', async () => {
      setSuggested(await api('workspaces.suggestName', { projectId }))
      setTyped(null)
    })

  useEffect(() => {
    void loadWorkspaces(projectId)
  }, [projectId, loadWorkspaces])

  useEffect(() => {
    void runAction('Suggest workspace name', async () => setSuggested(await api('workspaces.suggestName', { projectId })))
  }, [projectId])

  const create = async (withAgents: boolean): Promise<void> => {
    setBusy(withAgents ? 'full' : 'empty')
    const workspace = await runAction('Create workspace', () =>
      api('workspaces.create', {
        projectId,
        kind,
        name: name.trim(),
        association: associationRef.trim() ? { kind: associationKind, ref: associationRef.trim() } : undefined,
        cliSelections: withAgents ? config.cliSelections : [],
        autoApprove: config.autoApprove,
        ...(kind === 'isolated' ? { baseRef: git.baseRef, branch: git.branch, useExistingBranch: git.useExistingBranch } : {})
      })
    )
    setBusy(null)
    if (workspace) {
      onClose()
      openWorkspace(projectId, workspace.id)
    }
  }

  const count = totalInstances(config.cliSelections)
  const kindBlocked = (kind === 'main' && hasMain) || (kind === 'isolated' && !git.ready)
  const canSubmit = name.trim().length > 0 && !busy && !kindBlocked

  return (
    <Modal
      open
      title="Create workspace"
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
        <div className={styles.association}>
          <span className={styles.label}>Where agents work</span>
          <div className={styles.kinds} role="radiogroup" aria-label="Workspace type">
            <KindOption
              selected={kind === 'main'}
              disabled={hasMain}
              title="Project folder"
              description={hasMain ? 'This project already has a main workspace.' : 'Agents work directly in the project folder.'}
              onSelect={() => setKind('main')}
            />
            <KindOption
              selected={kind === 'isolated'}
              disabled={false}
              title="New branch"
              description="An isolated copy on its own branch, so agents never collide."
              onSelect={() => setKind('isolated')}
            />
          </div>
        </div>
        <TextField
          label="Workspace name"
          value={name}
          onChange={setTyped}
          maxLength={60}
          adornment={
            kind === 'isolated' && <IconButton label="Suggest another name" icon={<Dices />} size="lg" onClick={suggest} />
          }
        />
        {kind === 'isolated' && (
          <GitOptions projectId={projectId} suggestedBranch={`hiveory/${slugify(name)}`} onChange={onGitChange} />
        )}
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
                setConfig({ cliSelections: preset.cliSelections, autoApprove: preset.autoApprove })
                setTab('agents')
              }}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}

interface KindOptionProps {
  selected: boolean
  disabled: boolean
  title: string
  description: string
  onSelect: () => void
}

function KindOption({ selected, disabled, title, description, onSelect }: KindOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      className={styles.kind}
      onClick={onSelect}
    >
      <span className={styles.kindTitle}>{title}</span>
      <span className={styles.kindText}>{description}</span>
    </button>
  )
}
