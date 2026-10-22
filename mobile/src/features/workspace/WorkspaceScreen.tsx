import { useState } from 'react'
import { Stack, router } from 'expo-router'
import { FolderTree, GitBranch, MoreVertical, Plus, SquareTerminal, Wrench } from 'lucide-react-native'
import { useAction, useCall, useCliIcons } from '@/core/api'
import { routes } from '@/core/routes'
import { useTheme } from '@/core/theme'
import { AgentCard, Button, choose, confirm, EmptyState, IconButton, ListRow, Loading, PromptSheet, Screen, Section, STATUS_ORDER } from '@/core/ui'
import { OpenAgentSheet } from './OpenAgentSheet'

/**
 * A worktree's branch and changes, its files, its agents most urgent first, and one button to open
 * another. Its menu saves its agents as a preset and deletes an isolated worktree (ADR 0053).
 */
export function WorkspaceScreen({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const workspaces = useCall('workspaces.list', { projectId })
  const workspace = workspaces.data?.find((w) => w.id === workspaceId)
  const agents = useCall('agents.list', { workspaceId })
  const git = useCall('workspaces.gitStatus', { workspaceId })
  const { colors } = useTheme()
  const icons = useCliIcons(projectId)
  const [opening, setOpening] = useState(false)
  const [naming, setNaming] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const remove = useAction('workspaces.delete')
  const repair = useAction('workspaces.repair')
  const savePreset = useAction('presets.save')

  /** Its agents as a preset: how many of each CLI, and whether they open as chats. */
  const saveAs = (name: string): void => {
    const counts = new Map<string, number>()
    for (const a of agents.data ?? []) counts.set(a.cliId, (counts.get(a.cliId) ?? 0) + 1)
    const list = agents.data ?? []
    savePreset.mutate(
      { name, cliSelections: [...counts].map(([cliId, count]) => ({ cliId, count: Math.min(count, 8) })), autoApprove: list.every((a) => a.autoApprove), chatUi: list.some((a) => a.chatUi) },
      { onSuccess: () => setNaming(false) }
    )
  }
  const menu = (): void =>
    choose(workspace?.name ?? 'Worktree', [
      ...(agents.data?.length ? [{ label: 'Save its agents as a preset', onPress: () => setNaming(true) }] : []),
      ...(workspace?.kind === 'isolated'
        ? [
            {
              label: 'Delete worktree',
              destructive: true,
              onPress: () =>
                confirm(`Delete ${workspace.name}?`, 'Its agents close and its folder is removed from the computer. Its branch stays.', 'Delete', () =>
                  remove.mutate({ workspaceId, force: true }, { onSuccess: () => router.back() })
                )
            }
          ]
        : [])
    ])
  const sorted = [...(agents.data ?? [])].sort((a, b) => STATUS_ORDER.indexOf(a.runtime.status) - STATUS_ORDER.indexOf(b.runtime.status))

  if (agents.isLoading) return <Loading />

  return (
    <>
      <Stack.Screen options={{ title: workspace?.name ?? 'Worktree', headerRight: () => <IconButton label="Worktree actions" icon={MoreVertical} onPress={menu} /> }} />
      <Screen
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true)
          void Promise.all([agents.refetch(), git.refetch()]).finally(() => setRefreshing(false))
        }}
      >
        {git.data ? (
          <ListRow
            title={git.data.branch ?? workspace?.git?.branch ?? 'Detached'}
            subtitle={
              [
                git.data.changed ? `${git.data.changed} changed` : null,
                git.data.untracked ? `${git.data.untracked} new` : null,
                git.data.ahead ? `${git.data.ahead} to push` : null,
                git.data.behind ? `${git.data.behind} behind` : null
              ]
                .filter(Boolean)
                .join(' · ') || 'Clean, up to date'
            }
            leading={<GitBranch size={18} color={colors.brand} />}
            label={`Branch ${git.data.branch ?? ''}`}
          />
        ) : null}
        {workspace && !workspace.healthy ? (
          <ListRow title="Its folder is missing" subtitle="Repair recreates it from its branch" leading={<Wrench size={18} color={colors.waiting} />} onPress={() => repair.mutate({ workspaceId })} />
        ) : null}
        <ListRow title="Files" subtitle="Browse, read and edit" leading={<FolderTree size={18} color={colors.textMuted} />} onPress={() => router.push(routes.files(workspaceId, projectId))} />
        <Button label="Open an agent" variant="primary" icon={Plus} block onPress={() => setOpening(true)} />
        {sorted.length ? (
          <Section title="Agents">
            {sorted.map((a) => (
              <AgentCard
                key={a.id}
                compact={a.runtime.status !== 'waiting-for-you'}
                petName={a.petName}
                icon={icons.get(a.cliId)}
                runtime={a.runtime}
                onPress={() => router.push(routes.agent(a.id, workspaceId, projectId))}
              />
            ))}
          </Section>
        ) : (
          <EmptyState icon={SquareTerminal} title="No agents here yet" body="Open one, or apply a preset, to start working in this worktree." />
        )}
      </Screen>
      <OpenAgentSheet workspaceId={workspaceId} projectId={projectId} open={opening} onClose={() => setOpening(false)} />
      <PromptSheet open={naming} title="Save as preset" label="Preset name" action="Save" maxLength={60} busy={savePreset.isPending} onSubmit={saveAs} onClose={() => setNaming(false)} />
    </>
  )
}
