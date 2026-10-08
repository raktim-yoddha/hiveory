import { useMemo, useState } from 'react'
import { Stack, router } from 'expo-router'
import { CheckCheck, CirclePause, FolderGit2, GitBranch, Moon, Plus, type LucideIcon } from 'lucide-react-native'
import type { CliStatus } from '@shared/domain/cli'
import { useCall, useCliIcons } from '@/core/api'
import { routes } from '@/core/routes'
import { useTheme } from '@/core/theme'
import { AgentCard, Button, EmptyState, ListRow, Loading, Screen, Section, Segmented, STATUS_LABEL, STATUS_ORDER } from '@/core/ui'
import { NewWorkspaceSheet } from './NewWorkspaceSheet'

/** What an empty status tab says: nothing waiting is good news, nothing working is a pause, nothing idle is asleep. */
const EMPTY: Record<CliStatus, { icon: LucideIcon; title: string }> = {
  'waiting-for-you': { icon: CheckCheck, title: 'Nothing needs you' },
  working: { icon: CirclePause, title: 'No agent is working' },
  idle: { icon: Moon, title: 'No idle agents' }
}

/**
 * One workspace: its worktrees first (they stay put; tap the heading to fold them), then its board
 * as tabs (the desktop's three Kanban columns, one at a time on a phone, what needs the user first).
 */
export function ProjectScreen({ projectId }: { projectId: string }) {
  const { colors } = useTheme()
  const projects = useCall('projects.list', undefined)
  const project = projects.data?.find((p) => p.id === projectId)
  const board = useCall('kanban.board', { projectId })
  const workspaces = useCall('workspaces.list', { projectId })
  const icons = useCliIcons(projectId)
  const [picked, setPicked] = useState<CliStatus | null>(null)
  const [creating, setCreating] = useState(false)
  const [worktreesFolded, setWorktreesFolded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Until the user picks a tab, show the most urgent one that has agents.
  const status = useMemo(() => picked ?? STATUS_ORDER.find((s) => board.data?.[s].length) ?? 'waiting-for-you', [picked, board.data])
  const cards = board.data?.[status] ?? []

  if (board.isLoading || workspaces.isLoading) return <Loading />

  return (
    <>
      <Stack.Screen options={{ title: project?.name ?? 'Workspace' }} />
      <Screen
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true)
          void Promise.all([board.refetch(), workspaces.refetch()]).finally(() => setRefreshing(false))
        }}
      >
        <Section
          title={`Worktrees · ${workspaces.data?.length ?? 0}`}
          collapsed={worktreesFolded}
          onToggle={() => setWorktreesFolded((f) => !f)}
          aside={<Button label="New" size="sm" icon={Plus} onPress={() => setCreating(true)} />}
        >
          {(workspaces.data ?? []).map((w) => (
            <ListRow
              key={w.id}
              title={w.name}
              subtitle={[w.kind === 'main' ? 'Primary folder' : w.git?.branch, `${w.agentCount} ${w.agentCount === 1 ? 'agent' : 'agents'}`, w.healthy ? null : 'folder missing'].filter(Boolean).join(' · ')}
              leading={w.kind === 'main' ? <FolderGit2 size={18} color={colors.textMuted} /> : <GitBranch size={18} color={colors.brand} />}
              onPress={() => router.push(routes.workspace(w.id, projectId))}
            />
          ))}
          {!workspaces.data?.length ? <EmptyState icon={GitBranch} title="No worktrees yet" body="Create one to open agents in it." /> : null}
        </Section>
        <Section>
          <Segmented
            label="Agents by status"
            value={status}
            onChange={setPicked}
            options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s], count: board.data?.[s].length ?? 0 }))}
          />
          {cards.length ? (
            cards.map((c) => (
              <AgentCard
                key={c.instanceId}
                compact={status !== 'waiting-for-you'}
                petName={c.petName}
                icon={icons.get(c.cliId)}
                runtime={c.runtime}
                place={c.workspaceName}
                onPress={() => router.push(routes.agent(c.instanceId, c.workspaceId, projectId))}
              />
            ))
          ) : (
            <EmptyState icon={EMPTY[status].icon} title={EMPTY[status].title} body="Open an agent from one of the worktrees." />
          )}
        </Section>
      </Screen>
      <NewWorkspaceSheet projectId={projectId} open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
