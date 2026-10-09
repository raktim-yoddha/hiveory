import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { Plus } from 'lucide-react-native'
import { branchPrefixOf } from '@shared/domain/project'
import { call, useAction, useCall, useConnection } from '@/core/api'
import { routes } from '@/core/routes'
import { Button, Segmented, Sheet, Text, TextField } from '@/core/ui'

const slug = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * A new isolated workspace (its own branch and folder, ADR 0011): a name suggested by the computer
 * and how its agents open. The branch follows the Workspace's settings (ADR 0037); Git work
 * happens there, as on the desktop.
 */
export function NewWorkspaceSheet({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const { computer, token } = useConnection()
  const project = useCall('projects.list', undefined).data?.find((p) => p.id === projectId)
  const [name, setName] = useState('')
  const [view, setView] = useState<'terminal' | 'chat' | null>(null)
  const create = useAction('workspaces.create')
  const chosen = view ?? (project?.settings?.agentView === 'chat' ? 'chat' : 'terminal')

  useEffect(() => {
    if (!open || !computer || !token) return
    void call(computer, token, 'workspaces.suggestName', { projectId }).then(setName, () => undefined)
  }, [open, computer, token, projectId])

  const submit = (): void =>
    create.mutate(
      { projectId, kind: 'isolated', name: name.trim(), cliSelections: [], autoApprove: false, chatUi: chosen === 'chat' },
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
      footer={<Button label="Create" variant="primary" icon={Plus} block loading={create.isPending} disabled={!name.trim()} onPress={submit} />}
    >
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
