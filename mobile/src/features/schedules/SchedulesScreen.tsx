import { useState } from 'react'
import { router, Stack } from 'expo-router'
import { CalendarClock, Play, Plus } from 'lucide-react-native'
import type { RoutineView } from '@shared/domain/routine'
import { describeSchedule } from '@shared/domain/routine-text'
import { useAction, useCall } from '@/core/api'
import { routes } from '@/core/routes'
import { Button, EmptyState, IconButton, ListRow, Loading, Screen, Section } from '@/core/ui'

const LAST: Record<string, string> = { running: 'running now', completed: 'last run done', failed: 'last run failed', missed: 'last run missed', skipped: 'last run skipped' }

/** Its rule in words, and how its last run went. */
const describe = (r: RoutineView): string => [r.enabled ? describeSchedule(r) : 'Off', r.lastRun ? (LAST[r.lastRun.status] ?? r.lastRun.status) : null].filter(Boolean).join(' · ')

/**
 * Schedules on the phone (ADR 0052, 0053, 0056): a Workspace's Schedules (or every one on the
 * computer) with its rule and last run, and Run now; + makes one, a tap edits one.
 */
export function SchedulesScreen({ projectId }: { projectId?: string }) {
  const routines = useCall('routines.list', undefined)
  const run = useAction('routines.runNow')
  const [refreshing, setRefreshing] = useState(false)
  const header = <Stack.Screen options={{ headerRight: () => <IconButton label="New schedule" icon={Plus} onPress={() => router.push(routes.schedule(undefined, projectId))} /> }} />

  if (routines.isLoading) return <Loading label="Loading schedules…" />
  const list = (routines.data ?? []).filter((r) => !projectId || r.target.projectId === projectId).sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  if (!list.length) {
    return (
      <>
        {header}
        <EmptyState icon={CalendarClock} title="No schedules yet" body="Work an agent does on its own at set times." action={<Button label="New schedule" icon={Plus} variant="primary" onPress={() => router.push(routes.schedule(undefined, projectId))} />} />
      </>
    )
  }

  return (
    <>
      {header}
      <Screen
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true)
          void routines.refetch().finally(() => setRefreshing(false))
        }}
      >
        <Section>
          {list.map((r) => (
            <ListRow
              key={r.id}
              title={r.name}
              subtitle={[r.lastRun?.where, describe(r)].filter(Boolean).join(' · ')}
              onPress={() => router.push(routes.schedule(r.id))}
              action={
                <Button
                  label="Run now"
                  size="sm"
                  icon={Play}
                  loading={run.isPending && run.variables?.routineId === r.id}
                  disabled={r.lastRun?.status === 'running'}
                  onPress={() => run.mutate({ routineId: r.id })}
                />
              }
            />
          ))}
        </Section>
      </Screen>
    </>
  )
}
