import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Stack } from 'expo-router'
import { ArrowUp, FileDiff, GitBranch, GitCommitHorizontal, Undo2 } from 'lucide-react-native'
import type { ChangedFile, ChangeSource } from '@shared/domain/changes'
import { diffLines, shortCount } from '@shared/domain/diff'
import { useAction, useCall } from '@/core/api'
import { font, radius, space, useTheme } from '@/core/theme'
import { Button, confirm, EmptyState, IconButton, ListRow, Loading, Screen, Section, Segmented, Text, TextField } from '@/core/ui'

type Kind = 'uncommitted' | 'branch'
const MAX_LINES = 1500

/**
 * A worktree's changes on the phone (ADR 0060), as the desktop's Changes tab shows them: uncommitted
 * work or the whole branch, each file's diff, Commit (and push), Push, and Discard for one file.
 */
export function ChangesScreen({ workspaceId }: { workspaceId: string }) {
  const { colors } = useTheme()
  const [kind, setKind] = useState<Kind>('uncommitted')
  const source: ChangeSource = { kind }
  const changes = useCall('changes.list', { workspaceId, source }, { refetchInterval: 10_000 })
  const status = useCall('workspaces.gitStatus', { workspaceId })
  const commit = useAction('changes.commit')
  const push = useAction('changes.push')
  const discard = useAction('changes.discard')
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const reload = (): Promise<unknown> => Promise.all([changes.refetch(), status.refetch()])
  const files = changes.data?.files ?? []
  const toPush = status.data?.branch ? (status.data.upstream ? status.data.ahead : 1) : 0
  const canCommit = kind === 'uncommitted' && files.length > 0 && message.trim().length > 0 && !commit.isPending

  const doCommit = (andPush: boolean): void =>
    commit.mutate(
      { workspaceId, message },
      {
        onSuccess: () => {
          setMessage('')
          if (andPush) push.mutate({ workspaceId }, { onSettled: () => void reload() })
          else void reload()
        }
      }
    )
  const doDiscard = (file: ChangedFile): void =>
    confirm(`Discard changes to ${file.path.split('/').at(-1)}?`, file.status === 'added' ? 'This new file is deleted.' : 'It goes back to how it is in the last commit.', 'Discard', () =>
      discard.mutate({ workspaceId, paths: file.from ? [file.from, file.path] : [file.path] }, { onSuccess: () => void reload() })
    )

  if (changes.isLoading) return <Loading />
  const data = changes.data

  return (
    <>
      <Stack.Screen options={{ title: 'Changes' }} />
      <Screen
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true)
          void reload().finally(() => setRefreshing(false))
        }}
      >
        <Segmented
          label="Which changes"
          value={kind}
          onChange={(v) => {
            setKind(v)
            setOpen(null)
          }}
          options={[
            { value: 'uncommitted', label: 'Uncommitted' },
            { value: 'branch', label: 'Branch' }
          ]}
        />
        <ListRow
          title={data?.branch ?? 'No branch'}
          subtitle={data ? `${files.length} ${files.length === 1 ? 'file' : 'files'} · +${shortCount(data.additions)} −${shortCount(data.deletions)}${data.base ? ` · against ${data.base}` : ''}` : undefined}
          leading={<GitBranch size={18} color={colors.brand} />}
          trailing={toPush > 0 ? <Button size="sm" label={status.data?.upstream ? `Push ${toPush}` : 'Publish'} icon={ArrowUp} loading={push.isPending} onPress={() => push.mutate({ workspaceId }, { onSettled: () => void reload() })} /> : undefined}
        />
        {data?.note ? (
          <EmptyState icon={FileDiff} title="No changes to show" body={data.note} />
        ) : files.length === 0 ? (
          <EmptyState icon={FileDiff} title="No changes" body={kind === 'uncommitted' ? 'Files the agents (or you) change show up here.' : 'This branch has nothing its base lacks.'} />
        ) : (
          <>
            {kind === 'uncommitted' ? (
              <Section title="Commit">
                <TextField accessibilityLabel="Commit message" placeholder="Commit message" value={message} onChangeText={setMessage} multiline maxLength={5000} />
                <View style={styles.actions}>
                  <Button label="Commit" variant="primary" icon={GitCommitHorizontal} disabled={!canCommit} loading={commit.isPending} onPress={() => doCommit(false)} />
                  {status.data?.branch ? <Button label="Commit & push" disabled={!canCommit} onPress={() => doCommit(true)} /> : null}
                </View>
              </Section>
            ) : null}
            <Section title="Files">
              {files.map((file) => (
                <View key={file.path}>
                  <ListRow
                    title={file.path.split('/').at(-1) ?? file.path}
                    subtitle={`${file.status}${file.binary ? ' · binary' : ` · +${file.additions} −${file.deletions}`} · ${file.from ? `${file.from} → ` : ''}${file.path}`}
                    onPress={() => setOpen(open === file.path ? null : file.path)}
                    action={kind === 'uncommitted' ? <IconButton label={`Discard changes to ${file.path}`} icon={Undo2} onPress={() => doDiscard(file)} /> : undefined}
                  />
                  {open === file.path ? <FileDiffView workspaceId={workspaceId} source={source} path={file.path} /> : null}
                </View>
              ))}
            </Section>
          </>
        )}
      </Screen>
    </>
  )
}

/** One file's diff, colored by line, scrolled sideways for long lines. */
function FileDiffView({ workspaceId, source, path }: { workspaceId: string; source: ChangeSource; path: string }) {
  const { colors } = useTheme()
  const diff = useCall('changes.diff', { workspaceId, source, path })
  const lines = useMemo(() => diffLines(diff.data ?? ''), [diff.data])
  if (diff.isLoading) return <Loading />
  if (!lines.length) return <Text tone="muted" style={styles.note}>No line changes.</Text>
  const tint = { add: colors.workingSoft, del: colors.dangerSoft, hunk: colors.surfaceRaised, context: 'transparent', note: 'transparent' } as const
  const ink = { add: colors.success, del: colors.danger, hunk: colors.textMuted, context: colors.textSecondary, note: colors.textMuted } as const
  return (
    <ScrollView horizontal style={[styles.diff, { backgroundColor: colors.surfaceInset }]} accessibilityLabel={`Changes in ${path}`}>
      <View>
        {lines.slice(0, MAX_LINES).map((line, i) => (
          <Text key={i} style={[styles.line, { backgroundColor: tint[line.kind], color: ink[line.kind] }]}>
            {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '− ' : '  '}
            {line.text}
          </Text>
        ))}
        {lines.length > MAX_LINES ? <Text tone="muted" style={styles.line}>… {lines.length - MAX_LINES} more lines</Text> : null}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space[4], marginTop: space[4] },
  diff: { borderRadius: radius.sm, paddingVertical: space[3], marginTop: space[2] },
  line: { fontFamily: font.mono, fontSize: font.size.caption, paddingHorizontal: space[4] },
  note: { padding: space[4] }
})
