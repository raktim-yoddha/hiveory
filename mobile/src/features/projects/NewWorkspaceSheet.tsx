import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { Check, Plus } from 'lucide-react-native'
import { branchPrefixOf } from '@shared/domain/project'
import { call, useAction, useCall, useConnection } from '@/core/api'
import { routes } from '@/core/routes'
import { Button, ListRow, Loading, Segmented, Sheet, Text, TextField } from '@/core/ui'

type Source = 'new' | 'existing' | 'remote'

const slug = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * A new worktree (its own branch and folder): a name suggested by the computer, where its branch
 * comes from — a new one (the Workspace's prefix and base, ADR 0037), an existing local branch, or
 * a remote one (fetched first), as on the computer (ADR 0039) — and how its agents open.
 */
export function NewWorkspaceSheet({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const { computer, token } = useConnection()
  const project = useCall('projects.list', undefined).data?.find((p) => p.id === projectId)
  const [name, setName] = useState('')
  const [view, setView] = useState<'terminal' | 'chat' | null>(null)
  const [source, setSource] = useState<Source>('new')
  const [branch, setBranch] = useState<string | null>(null)
  const git = useCall('git.info', { projectId, fetch: source === 'remote' }, { enabled: open && source !== 'new' })
  const inUse = new Set(git.data?.branchesInUse ?? [])
  const branches = source === 'existing' ? (git.data?.branches ?? []).filter((b) => !inUse.has(b)) : source === 'remote' ? (git.data?.remoteBranches ?? []).filter((r) => !inUse.has(r.slice(r.indexOf('/') + 1))) : []
  const picked = branch && branches.includes(branch) ? branch : branches[0]
  const create = useAction('workspaces.create')
  const chosen = view ?? (project?.settings?.agentView === 'chat' ? 'chat' : 'terminal')

  useEffect(() => {
    if (!open || !computer || !token) return
    void call(computer, token, 'workspaces.suggestName', { projectId }).then(setName, () => undefined)
  }, [open, computer, token, projectId])

  const submit = (): void =>
    create.mutate(
      {
        projectId,
        kind: 'isolated',
        name: name.trim(),
        cliSelections: [],
        autoApprove: false,
        chatUi: chosen === 'chat',
        ...(source === 'existing' ? { branch: picked, useExistingBranch: true } : source === 'remote' ? { remoteBranch: picked } : {})
      },
      {
        onSuccess: (workspace) => {
          onClose()
          router.push(routes.workspace(workspace.id, projectId))
        }
      }
    )

  return (
    <Sheet
      open={open}
      title="New worktree"
      onClose={onClose}
      footer={<Button label="Create" variant="primary" icon={Plus} block loading={create.isPending} disabled={!name.trim() || (source !== 'new' && !picked)} onPress={submit} />}
    >
      <Segmented
        label="Branch"
        value={source}
        onChange={setSource}
        options={[
          { value: 'new', label: 'New' },
          { value: 'existing', label: 'Existing' },
          { value: 'remote', label: 'Remote' }
        ]}
      />
      <Text tone="muted">Its own branch and folder, so its agents never step on the main one.</Text>
      <TextField
        label="Name"
        hint={`Branch ${branchPrefixOf(project)}${slug(name)}${project?.settings?.baseRef ? `, from ${project.settings.baseRef}` : ''}`}
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={submit}
        maxLength={60}
      />
      {source !== 'new' ? (
        git.isLoading ? (
          <Loading />
        ) : branches.length ? (
          branches.map((b) => <ListRow key={b} title={b} trailing={b === picked ? <Check size={18} /> : null} onPress={() => setBranch(b)} />)
        ) : (
          <Text tone="muted">{source === 'existing' ? 'Every local branch is already open in a worktree.' : 'No remote branches (or the remote could not be reached).'}</Text>
        )
      ) : null}
      {project?.host ? null : (
        <Segmented
          label="Its agents open as"
          value={chosen}
          onChange={setView}
          options={[
            { value: 'terminal', label: 'Terminal' },
            { value: 'chat', label: 'Chat' }
          ]}
        />
      )}
    </Sheet>
  )
}
