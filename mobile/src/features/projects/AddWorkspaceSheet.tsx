import { useState } from 'react'
import { router } from 'expo-router'
import { FolderPlus } from 'lucide-react-native'
import { useAction } from '@/core/api'
import { routes } from '@/core/routes'
import { Button, Segmented, Sheet, Text, TextField } from '@/core/ui'

/**
 * Adds a Workspace from the phone (ADR 0053): a folder already on the computer, or a repository
 * cloned into a folder there. The phone has no picker for the computer's disk, so the path is typed.
 */
export function AddWorkspaceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const add = useAction('projects.add')
  const [mode, setMode] = useState<'folder' | 'clone'>('folder')
  const [path, setPath] = useState('')
  const [url, setUrl] = useState('')
  const ready = mode === 'folder' ? path.trim() : url.trim() && path.trim()

  const submit = (): void => {
    if (!ready) return
    add.mutate(mode === 'folder' ? { mode: 'folder', path: path.trim() } : { mode: 'clone', url: url.trim(), parentDir: path.trim() }, {
      onSuccess: (project) => {
        onClose()
        setPath('')
        setUrl('')
        router.push(routes.project(project.id))
      }
    })
  }

  return (
    <Sheet open={open} title="Add a workspace" onClose={onClose} footer={<Button label="Add" variant="primary" icon={FolderPlus} block loading={add.isPending} disabled={!ready} onPress={submit} />}>
      <Segmented
        label="From"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'folder', label: 'A folder' },
          { value: 'clone', label: 'Clone a repository' }
        ]}
      />
      {mode === 'clone' ? <TextField label="Repository URL" placeholder="https://github.com/owner/repo" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" /> : null}
      <TextField
        label={mode === 'folder' ? 'Folder on the computer' : 'Clone into the folder'}
        placeholder={mode === 'folder' ? 'C:\\Users\\me\\code\\app or /home/me/app' : 'C:\\Users\\me\\code or /home/me/code'}
        value={path}
        onChangeText={setPath}
        autoCapitalize="none"
        mono
      />
      <Text tone="muted">The full path on the computer, as it would appear there.</Text>
    </Sheet>
  )
}
