import { useState } from 'react'
import { router, Stack } from 'expo-router'
import { File, Folder, FolderOpen, MoreVertical, Plus } from 'lucide-react-native'
import type { FileEntry } from '@shared/domain/files'
import { useAction, useCall } from '@/core/api'
import { routes } from '@/core/routes'
import { useTheme } from '@/core/theme'
import { choose, confirm, EmptyState, IconButton, ListRow, Loading, PromptSheet, Screen, Section, TextField } from '@/core/ui'

const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)
const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/')

type Asking = { kind: 'file' | 'dir' } | { kind: 'rename'; entry: FileEntry } | null

/**
 * A worktree's files on the phone (ADR 0053), one folder at a time as on the computer's file tree:
 * open a folder or a file, search by name, make a file or folder, rename and delete.
 */
export function FilesScreen({ workspaceId, projectId, dir }: { workspaceId: string; projectId: string; dir: string }) {
  const { colors } = useTheme()
  const scope = { workspaceId }
  const [query, setQuery] = useState('')
  const list = useCall('files.list', { scope, dir })
  const found = useCall('files.search', { scope, query: query.trim() }, { enabled: query.trim().length > 1 })
  const create = useAction('files.create')
  const rename = useAction('files.rename')
  const remove = useAction('files.delete')
  const [asking, setAsking] = useState<Asking>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = (): void => void list.refetch()

  const open = (e: FileEntry): void => router.push(e.kind === 'dir' ? routes.files(workspaceId, projectId, e.path) : routes.file(workspaceId, projectId, e.path))
  const more = (e: FileEntry): void =>
    choose(e.name, [
      { label: 'Rename', onPress: () => setAsking({ kind: 'rename', entry: e }) },
      {
        label: 'Delete',
        destructive: true,
        onPress: () => confirm(`Delete ${e.name}?`, e.kind === 'dir' ? 'The folder and everything in it go to the computer’s trash.' : 'It goes to the computer’s trash.', 'Delete', () => remove.mutate({ scope, paths: [e.path] }, { onSuccess: refresh }))
      }
    ])
  const submit = (name: string): void => {
    if (!asking) return
    const done = { onSuccess: () => (setAsking(null), refresh()) }
    if (asking.kind === 'rename') rename.mutate({ scope, from: asking.entry.path, to: join(parentOf(asking.entry.path), name) }, done)
    else create.mutate({ scope, path: join(dir, name), kind: asking.kind }, done)
  }

  const entries = query.trim().length > 1 ? (found.data ?? []) : [...(list.data?.entries ?? [])].sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name))
  const title = dir ? (dir.split('/').at(-1) ?? dir) : 'Files'

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <IconButton
              label="New file or folder"
              icon={Plus}
              onPress={() =>
                choose('New', [
                  { label: 'File', onPress: () => setAsking({ kind: 'file' }) },
                  { label: 'Folder', onPress: () => setAsking({ kind: 'dir' }) }
                ])
              }
            />
          )
        }}
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <Screen
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true)
            void list.refetch().finally(() => setRefreshing(false))
          }}
        >
          {!dir ? <TextField label="Find a file" placeholder="Name or part of it" value={query} onChangeText={setQuery} autoCapitalize="none" /> : null}
          {entries.length ? (
            <Section>
              {entries.map((e) => (
                <ListRow
                  key={e.path}
                  title={e.name}
                  subtitle={query.trim() && e.path !== e.name ? e.path : undefined}
                  leading={e.kind === 'dir' ? <Folder size={18} color={colors.brand} /> : <File size={18} color={colors.textMuted} />}
                  action={<IconButton label={`More for ${e.name}`} icon={MoreVertical} onPress={() => more(e)} />}
                  onPress={() => open(e)}
                />
              ))}
            </Section>
          ) : (
            <EmptyState icon={FolderOpen} title={query.trim() ? 'Nothing by that name' : 'This folder is empty'} body="Add a file or folder with +." />
          )}
        </Screen>
      )}
      <PromptSheet
        open={asking !== null}
        title={asking?.kind === 'rename' ? `Rename ${asking.entry.name}` : asking?.kind === 'dir' ? 'New folder' : 'New file'}
        label="Name"
        initial={asking?.kind === 'rename' ? asking.entry.name : ''}
        action={asking?.kind === 'rename' ? 'Rename' : 'Create'}
        busy={create.isPending || rename.isPending}
        onSubmit={submit}
        onClose={() => setAsking(null)}
      />
    </>
  )
}
