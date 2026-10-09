import { useState } from 'react'
import { Stack, router } from 'expo-router'
import { GitBranch, Plus, SquareTerminal } from 'lucide-react-native'
import { useCall, useCliIcons } from '@/core/api'
import { routes } from '@/core/routes'
import { useTheme } from '@/core/theme'
import { AgentCard, Button, EmptyState, ListRow, Loading, Screen, Section, STATUS_ORDER } from '@/core/ui'
import { OpenAgentSheet } from './OpenAgentSheet'

/** A worktree's branch and changes, its agents most urgent first, and one button to open another. */
export function WorkspaceScreen({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const workspaces = useCall('workspaces.list', { projectId })
  const workspace = workspaces.data?.find((w) => w.id === workspaceId)
  const agents = useCall('agents.list', { workspaceId })
  const git = useCall('workspaces.gitStatus', { workspaceId })
  const { colors } = useTheme()
  const icons = useCliIcons(projectId)
  const [opening, setOpening] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const sorted = [...(agents.data ?? [])].sort((a, b) => STATUS_ORDER.indexOf(a.runtime.status) - STATUS_ORDER.indexOf(b.runtime.status))

  if (agents.isLoading) return <Loading />

  return (
    <>
      <Stack.Screen options={{ title: workspace?.name ?? 'Worktree' }} />
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
    </>
  )
}
