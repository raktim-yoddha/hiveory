import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { Plus } from 'lucide-react-native'
import { call, useAction, useConnection } from '@/core/api'
import { routes } from '@/core/routes'
import { Button, Sheet, Text, TextField } from '@/core/ui'

/**
 * A new isolated workspace (its own branch and folder, ADR 0011): only a name,
 * suggested by the computer. Git work happens there, as on the desktop.
 */
export function NewWorkspaceSheet({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const { computer, token } = useConnection()
  const [name, setName] = useState('')
  const create = useAction('workspaces.create')

  useEffect(() => {
    if (!open || !computer || !token) return
    void call(computer, token, 'workspaces.suggestName', { projectId }).then(setName, () => undefined)
  }, [open, computer, token, projectId])

  const submit = (): void =>
    create.mutate(
      { projectId, kind: 'isolated', name: name.trim(), cliSelections: [], autoApprove: false },
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
      title="New workspace"
      onClose={onClose}
      footer={<Button label="Create" variant="primary" icon={Plus} block loading={create.isPending} disabled={!name.trim()} onPress={submit} />}
    >
      <Text tone="muted">Its own branch and folder, so its agents never step on the main one.</Text>
      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="none" returnKeyType="done" onSubmitEditing={submit} maxLength={60} />
    </Sheet>
  )
}
