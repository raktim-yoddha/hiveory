import { useState, type ReactNode } from 'react'
import { router } from 'expo-router'
import { Coffee, FolderOpen } from 'lucide-react-native'
import { useCliIcons } from '@/core/api'
import { routes } from '@/core/routes'
import { AgentCard, Button, EmptyState, Loading, Screen, Section } from '@/core/ui'
import { Overview } from './Overview'
import { useAttention, type AttentionItem } from './useAttention'

const place = (i: AttentionItem): string => `${i.projectName} · ${i.workspaceName}`

/**
 * The phone's home (ADR 0027): every agent at a glance, then what needs the user
 * right now across every workspace, then what is working. One tap opens the agent with its terminal.
 * `aside` is composed in by the route (e.g. the notifications prompt).
 */
export function InboxScreen({ aside }: { aside?: ReactNode }) {
  const { waiting, working, idle, projectCount, loading, refresh } = useAttention()
  const icons = useCliIcons()
  const [refreshing, setRefreshing] = useState(false)
  const open = (i: AttentionItem) => router.push(routes.agent(i.instanceId, i.workspaceId, i.projectId))

  if (loading && !waiting.length && !working.length) return <Loading label="Checking your agents…" />

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true)
        void refresh().finally(() => setRefreshing(false))
      }}
    >
      {projectCount ? <Overview waiting={waiting.length} working={working.length} idle={idle} workspaces={projectCount} /> : null}
      {aside}
      {waiting.length ? (
        <Section title={`Needs you · ${waiting.length}`}>
          {waiting.map((i) => (
            <AgentCard key={i.instanceId} petName={i.petName} icon={icons.get(i.cliId)} runtime={i.runtime} place={place(i)} onPress={() => open(i)} />
          ))}
        </Section>
      ) : null}
      {working.length ? (
        <Section title={`Working · ${working.length}`}>
          {working.map((i) => (
            <AgentCard key={i.instanceId} compact petName={i.petName} icon={icons.get(i.cliId)} runtime={i.runtime} place={place(i)} onPress={() => open(i)} />
          ))}
        </Section>
      ) : null}
      {!waiting.length && !working.length ? (
        projectCount ? (
          <EmptyState
            compact
            icon={Coffee}
            title="All quiet"
            body="What needs you shows up here."
            action={<Button label="Open a workspace" icon={FolderOpen} onPress={() => router.push(routes.projects)} />}
          />
        ) : (
          <EmptyState icon={FolderOpen} title="No workspaces yet" body="Add a workspace in Hiveory on your computer; it appears here right away." />
        )
      ) : null}
    </Screen>
  )
}
